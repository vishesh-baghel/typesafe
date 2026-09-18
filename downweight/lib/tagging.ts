/**
 * Everything that touches X's DOM, and the invariants that keep it harmless.
 *
 * Two rules the whole design rests on, both enforced here rather than by convention:
 *
 *   **A tag must not change the card's height.** It is absolutely positioned inside the
 *   card's existing bounds. A block-level element inserted into the flow would reflow the
 *   card under a reader's eyes, which is the exact failure that dropping collapse was
 *   meant to remove. `e2e/layout.spec.ts` measures this in a real browser, because jsdom
 *   has no layout engine and cannot.
 *
 *   **Everything is scoped under one root class.** Remove `dw-on` from the document
 *   element and every tag, every dim and every positioning rule stops applying at once.
 *   The kill switch, the fail-closed path on a selector break, and the teardown on
 *   disable are all the same mechanism, so there is one thing to get right instead of
 *   three.
 */

export const ROOT_CLASS = 'dw-on';
export const CARD_CLASS = 'dw-card';
export const TAG_CLASS = 'dw-tag';
export const DIM_CLASS = 'dw-dim';
export const STYLE_ID = 'dw-style';

/**
 * `position: relative` with no offsets occupies exactly the same box as `static`, so
 * making the card a positioning context is free. The tag is `pointer-events: none` so it
 * can never swallow a click meant for the post.
 */
export const STYLES = `
.${ROOT_CLASS} article[data-testid="tweet"].${CARD_CLASS} { position: relative; }
/*
 * Offset far enough left to clear X's own top-right controls on every card: the Grok
 * button and the overflow menu. At right:12px the tag landed on top of them, which both
 * looked broken and put a non-interactive element over two real ones.
 *
 * Exposed as a variable because the right number depends on X's chrome, which changes.
 * One value to retune rather than a hunt through the stylesheet.
 */
.${ROOT_CLASS} .${TAG_CLASS} {
  position: absolute;
  top: 10px;
  right: var(--dw-tag-right, 92px);
  z-index: 2;
  pointer-events: none;
  font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  padding: 2px 6px;
  border-radius: 4px;
  color: #1f4fd8;
  background: rgba(31, 79, 216, 0.10);
  border: 1px solid rgba(31, 79, 216, 0.22);
}
.${ROOT_CLASS} article[data-testid="tweet"].${DIM_CLASS} {
  opacity: 0.32;
  transition: opacity 140ms ease-out;
}
.${ROOT_CLASS} article[data-testid="tweet"].${DIM_CLASS}:hover { opacity: 1; }
`;

/** Idempotent. Re-injecting on every timeline mutation would otherwise pile up. */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(el);
}

export const enable = (doc: Document): void => {
  injectStyles(doc);
  doc.documentElement.classList.add(ROOT_CLASS);
};

/** Stops every visual effect at once without unpicking individual cards. */
export const disable = (doc: Document): void => {
  doc.documentElement.classList.remove(ROOT_CLASS);
};

export const isEnabled = (doc: Document): boolean =>
  doc.documentElement.classList.contains(ROOT_CLASS);

/**
 * Idempotent by construction: the existing tag is reused rather than a second one added.
 *
 * This is not defensive tidiness. X virtualises the timeline and re-renders the same card
 * repeatedly as the reader scrolls, and a slider drag retags every visible post, so this
 * runs many times per card in a normal session.
 */
export function applyTag(card: HTMLElement, tag: string, detail?: string): HTMLSpanElement {
  // Guarded rather than relying on the engine to skip a no-op write. Whether
  // `classList.add` of an existing class emits a mutation record is not something to
  // depend on across engines, and here a stray record restarts the paint loop.
  if (!card.classList.contains(CARD_CLASS)) card.classList.add(CARD_CLASS);

  let el = card.querySelector<HTMLSpanElement>(`:scope > .${TAG_CLASS}`);
  if (!el) {
    el = card.ownerDocument.createElement('span');
    el.className = TAG_CLASS;
    el.setAttribute('aria-hidden', 'true');
    card.appendChild(el);
  }

  /*
   * Write only on change, and this is not micro-optimisation.
   *
   * `el.textContent = tag` replaces the text node even when the string is identical, so
   * it emits a mutation record either way. The content script re-paints from a
   * MutationObserver on the timeline, so an unconditional write means paint mutates,
   * the observer fires, paint runs again: an infinite loop that pegs the tab. The same
   * shape froze capture mode. Idempotent has to mean "emits no mutation", not just
   * "produces the same DOM".
   */
  if (el.textContent !== tag) el.textContent = tag;
  if (detail) {
    if (el.getAttribute('title') !== detail) el.title = detail;
  } else if (el.hasAttribute('title')) {
    el.removeAttribute('title');
  }
  return el;
}

/**
 * `classList.remove` on the last class leaves `class=""` behind rather than removing the
 * attribute. On a page we do not own that is a real mutation, not a cosmetic one: it
 * shows up in React's reconciliation and in anything of X's that compares `className`.
 * Teardown is supposed to leave the DOM byte-identical, so it has to clean this up.
 */
function dropClass(el: Element, name: string): void {
  el.classList.remove(name);
  if (el.classList.length === 0) el.removeAttribute('class');
}

export function clearTag(card: HTMLElement): void {
  card.querySelector(`:scope > .${TAG_CLASS}`)?.remove();
  dropClass(card, CARD_CLASS);
}

export function setDimmed(card: HTMLElement, on: boolean): void {
  if (on) card.classList.add(DIM_CLASS);
  else dropClass(card, DIM_CLASS);
}

/**
 * Return every card to exactly how X rendered it.
 *
 * Called when the reader hits the kill switch, and when extraction stops matching, which
 * is the more important case: a broken extension must leave a normal timeline behind, not
 * a half-annotated one.
 */
export function teardown(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll(`.${TAG_CLASS}`))) el.remove();
  for (const el of Array.from(root.querySelectorAll(`.${CARD_CLASS}`))) dropClass(el, CARD_CLASS);
  for (const el of Array.from(root.querySelectorAll(`.${DIM_CLASS}`))) dropClass(el, DIM_CLASS);

  const doc = (root as Document).documentElement ? (root as Document) : null;
  if (doc) {
    disable(doc);
    doc.getElementById(STYLE_ID)?.remove();
  }
}
