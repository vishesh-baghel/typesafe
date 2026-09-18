import {
  assessCapture,
  buildCaptureFile,
  captureFilename,
  isConversationOperation,
  parseGraphqlOperation,
  readCsrf,
  REPLAY_BATCH,
  REPLAY_PAUSE_MS,
  replayHeaders,
  SESSION_KEY,
  shouldActivate,
  swapFocalTweetId,
} from '../../lib/capture';
import { SELECTORS } from '../../lib/extract';

/**
 * Capture mode. Runs at `document_start` in the MAIN world, which is the whole point.
 *
 * A console snippet cannot do this. Pasted into a loaded page it patches `window.fetch`
 * long after X has taken its own reference, so the patch is never invoked: measured on a
 * live timeline, the interceptor saw no bearer token and no TweetDetail request even
 * after navigating into a post. `document_start` runs before the page's own scripts, and
 * `world: "MAIN"` puts the patch on the same `window` X will use. Both are required.
 *
 * This file is deliberately inert unless asked for. Patching fetch on every X page load
 * for someone who is just reading would be a real cost for no reason, so capture only
 * starts on the #dw-capture hash.
 */

if (shouldActivate(location.hash, sessionStorage.getItem(SESSION_KEY))) {
  sessionStorage.setItem(SESSION_KEY, '1');
  start();
}

function start(): void {
  const cards = new Map<string, string>();
  const replies = new Map<string, unknown>();
  let auth: string | null = null;
  let detailUrl: string | null = null;
  let detailHeaders: Record<string, string> | null = null;
  let busy = false;
  /** Every GraphQL operation seen, so a miss is diagnosable instead of silent. */
  const seenOps = new Map<string, number>();

  // --- the patch, installed before X's bundle exists -----------------------------

  const headerFrom = (input: unknown, init: RequestInit | undefined, name: string): string | null => {
    if (input instanceof Request) {
      const v = input.headers.get(name);
      if (v) return v;
    }
    const h = init?.headers;
    if (!h) return null;
    if (h instanceof Headers) return h.get(name);
    if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name)?.[1] ?? null;
    return (h as Record<string, string>)[name] ?? null;
  };

  const collectHeaders = (input: unknown, init: RequestInit | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    if (input instanceof Request) input.headers.forEach((v, k) => (out[k] = v));
    const h = init?.headers;
    if (h instanceof Headers) h.forEach((v, k) => (out[k] = v));
    else if (h && !Array.isArray(h)) Object.assign(out, h);
    return out;
  };

  /**
   * One place both transports report into.
   *
   * X was observed loading a post page, replies on screen, without this ever matching on
   * `fetch` alone. Either the conversation goes over XHR or the operation is named
   * something else, so capture now watches both and records what it saw rather than
   * failing quietly.
   */
  const noteRequest = (url: string, headers: Record<string, string>): void => {
    const op = parseGraphqlOperation(url);
    if (!op) return;
    seenOps.set(op.operation, (seenOps.get(op.operation) ?? 0) + 1);

    const a = headers['authorization'] ?? headers['Authorization'];
    if (a) auth = a;

    if (!detailUrl && isConversationOperation(op.operation)) {
      detailUrl = url;
      detailHeaders = headers;
    }
    render();
  };

  /*
   * Bound to `window` deliberately, and this is load-bearing.
   *
   * X calls its stashed reference bare (`stashedFetch(url)`), so inside the patch `this`
   * is undefined. Forwarding with `origFetch.apply(this, ...)` then throws "Illegal
   * invocation", because fetch requires a Window receiver. That would not break capture,
   * it would break *X*: every request the page makes would reject as long as capture mode
   * was on. Caught by e2e/capture-timing.spec.ts.
   */
  const origFetch = window.fetch.bind(window);
  window.fetch = function (...args: Parameters<typeof fetch>) {
    try {
      const [input, init] = args;
      // Never construct a Request from these arguments. Doing so marks the original
      // body as consumed and breaks the very request being observed.
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url ?? '';
      const headers = collectHeaders(input, init);
      const a = headerFrom(input, init, 'authorization');
      if (a) headers['authorization'] = a;
      noteRequest(url, headers);
    } catch {
      // Instrumentation must never break the page it is observing.
    }
    return origFetch(...args);
  };

  /*
   * XHR as well as fetch. X mixes both, and the whole reason capture exists is that
   * assuming which one carries a request turned out to be wrong once already.
   */
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrSend = XMLHttpRequest.prototype.send;
  interface TrackedXhr extends XMLHttpRequest {
    __dwUrl?: string;
    __dwHeaders?: Record<string, string>;
  }

  XMLHttpRequest.prototype.open = function (this: TrackedXhr, method: string, url: string | URL, ...rest: unknown[]) {
    this.__dwUrl = String(url);
    this.__dwHeaders = {};
    return (xhrOpen as unknown as (...a: unknown[]) => void).call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (this: TrackedXhr, name: string, value: string) {
    if (this.__dwHeaders) this.__dwHeaders[name.toLowerCase()] = value;
    return xhrSetHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (
    this: TrackedXhr,
    ...args: Parameters<XMLHttpRequest['send']>
  ) {
    try {
      if (this.__dwUrl) noteRequest(this.__dwUrl, this.__dwHeaders ?? {});
    } catch {
      // Same rule as the fetch patch: never break the page being observed.
    }
    return xhrSend.apply(this, args);
  };

  // --- collection ----------------------------------------------------------------

  const collect = (): number => {
    for (const card of Array.from(document.querySelectorAll(SELECTORS.card))) {
      const href = card.querySelector(SELECTORS.permalink)?.getAttribute('href');
      const id = href?.match(/\/status\/(\d+)/)?.[1];
      if (id && !cards.has(id)) cards.set(id, card.outerHTML);
    }
    return cards.size;
  };

  // --- replay --------------------------------------------------------------------

  async function fetchAllReplies(onProgress: (done: number, total: number) => void): Promise<void> {
    const csrf = readCsrf(document.cookie);
    if (!detailUrl || !auth || !csrf) return;

    const headers = replayHeaders(detailHeaders, auth, csrf);
    const ids = [...cards.keys()].filter((id) => !replies.has(id));

    for (let i = 0; i < ids.length; i += REPLAY_BATCH) {
      await Promise.all(
        ids.slice(i, i + REPLAY_BATCH).map(async (id) => {
          const url = swapFocalTweetId(detailUrl!, id);
          if (!url) return;
          try {
            const res = await origFetch(url, { credentials: 'include', headers });
            if (res.ok) replies.set(id, await res.json());
          } catch {
            // A failed reply leaves the post at tier 1, which is a real outcome rather
            // than an error: the gate reports how many landed.
          }
        }),
      );
      onProgress(Math.min(i + REPLAY_BATCH, ids.length), ids.length);
      await new Promise((r) => setTimeout(r, REPLAY_PAUSE_MS));
    }
  }

  function download(): void {
    const file = buildCaptureFile(cards, replies, new Date().toISOString());
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = captureFilename(file.capturedAt);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  // --- badge ---------------------------------------------------------------------

  let badge: HTMLDivElement | null = null;
  let status = '';
  let rendering = false;

  function render(): void {
    if (rendering || !document.documentElement) return;
    rendering = true;
    try {
      paint();
    } finally {
      rendering = false;
    }
  }

  function paint(): void {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'dw-capture-badge';
      badge.style.cssText = [
        'position:fixed',
        'bottom:16px',
        'left:16px',
        'z-index:2147483647',
        'background:#11161f',
        'color:#e8edf5',
        'border:1px solid #2b3648',
        'border-radius:8px',
        'padding:10px 12px',
        'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
        'box-shadow:0 8px 24px rgba(0,0,0,.4)',
        'max-width:300px',
      ].join(';');
      /*
       * Appended to documentElement, not body, and this is not cosmetic.
       *
       * The MutationObserver below watches `document.body` with `subtree: true`. A badge
       * inside body means every render mutates the observed subtree, which fires the
       * observer, which renders again: an infinite loop that locks the tab solid. Keeping
       * the badge outside the observed root breaks the cycle at the source rather than
       * papering over it with a debounce. Caught by e2e/capture-timing.spec.ts.
       */
      document.documentElement.appendChild(badge);
    }

    const health = assessCapture(buildCaptureFile(cards, replies, ''), detailUrl !== null);
    badge.innerHTML = '';

    const line = document.createElement('div');
    line.textContent = `Downweight capture: ${health.posts} posts, ${health.withReplies} with replies`;
    badge.appendChild(line);

    if (!detailUrl && seenOps.size > 0) {
      const ops = [...seenOps.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, n]) => `${name} x${n}`)
        .join(', ');
      const o = document.createElement('div');
      o.style.cssText = 'color:#8aa0bd;margin-top:4px;word-break:break-word';
      o.textContent = `GraphQL seen: ${ops}`;
      badge.appendChild(o);
    }

    for (const problem of health.problems) {
      const p = document.createElement('div');
      p.style.cssText = 'color:#f0b429;margin-top:4px';
      p.textContent = problem;
      badge.appendChild(p);
    }

    if (status) {
      const s = document.createElement('div');
      s.style.cssText = 'color:#7fb0ff;margin-top:4px';
      s.textContent = status;
      badge.appendChild(s);
    }

    const row = document.createElement('div');
    row.style.cssText = 'margin-top:8px;display:flex;gap:6px';

    const go = document.createElement('button');
    go.textContent = busy ? 'working…' : 'Fetch replies + download';
    go.disabled = busy || !detailUrl;
    go.style.cssText = 'font:inherit;padding:4px 8px;cursor:pointer';
    go.onclick = async () => {
      busy = true;
      render();
      await fetchAllReplies((done, total) => {
        status = `replies ${done}/${total}`;
        render();
      });
      download();
      busy = false;
      status = 'downloaded';
      render();
    };
    row.appendChild(go);

    const stop = document.createElement('button');
    stop.textContent = 'Stop';
    stop.style.cssText = 'font:inherit;padding:4px 8px;cursor:pointer';
    stop.onclick = () => {
      sessionStorage.removeItem(SESSION_KEY);
      badge?.remove();
      badge = null;
    };
    row.appendChild(stop);

    badge.appendChild(row);
  }

  // --- wiring --------------------------------------------------------------------

  const boot = () => {
    collect();
    render();
    new MutationObserver(() => {
      collect();
      render();
    }).observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });

  // Exposed as a fallback in case the badge is ever covered by X's own UI.
  Object.assign(window, {
    __downweightCapture: {
      count: () => cards.size,
      ready: () => detailUrl !== null,
      run: async () => {
        await fetchAllReplies(() => undefined);
        download();
      },
    },
  });

  console.log(`[downweight] capture mode active. Open one post so the reply request can be learned.`);
}

export {};
