import { describe, expect, it } from 'vitest';
import {
  type ContentRequest,
  errorResponse,
  isContentRequest,
  isWorkerResponse,
  type WorkerResponse,
} from '../extension/src/messages';
import { rawPost } from './helpers';
import { scored } from './helpers';

describe('isContentRequest', () => {
  it('accepts a score request', () => {
    expect(isContentRequest({ kind: 'score', posts: [rawPost()] } satisfies ContentRequest)).toBe(true);
  });

  it('accepts an empty score batch', () => {
    expect(isContentRequest({ kind: 'score', posts: [] })).toBe(true);
  });

  it('accepts a settings request', () => {
    expect(isContentRequest({ kind: 'settings' })).toBe(true);
  });

  it('rejects a score request without posts', () => {
    expect(isContentRequest({ kind: 'score' })).toBe(false);
    expect(isContentRequest({ kind: 'score', posts: 'nope' })).toBe(false);
  });

  it('rejects an unknown kind', () => {
    // The content script runs in a page X controls, so anything arriving over this
    // boundary is untrusted and an unrecognised message must be dropped, not guessed at.
    expect(isContentRequest({ kind: 'evaluate', code: 'alert(1)' })).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const junk of [null, undefined, 42, 'score', []]) {
      expect(isContentRequest(junk)).toBe(false);
    }
  });
});

describe('isWorkerResponse', () => {
  it('accepts each valid response', () => {
    expect(isWorkerResponse({ kind: 'scored', posts: [scored('1')] } satisfies WorkerResponse)).toBe(true);
    expect(
      isWorkerResponse({ kind: 'settings', hasKey: true, weights: {}, threshold: 0.3, dimming: false }),
    ).toBe(true);
    expect(isWorkerResponse({ kind: 'error', reason: 'no key' })).toBe(true);
  });

  it('rejects malformed variants of each', () => {
    expect(isWorkerResponse({ kind: 'scored' })).toBe(false);
    expect(isWorkerResponse({ kind: 'settings', hasKey: 'yes' })).toBe(false);
    expect(isWorkerResponse({ kind: 'error' })).toBe(false);
    expect(isWorkerResponse({ kind: 'error', reason: 404 })).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(isWorkerResponse({ kind: 'whatever' })).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const junk of [null, undefined, 0, 'scored', []]) {
      expect(isWorkerResponse(junk)).toBe(false);
    }
  });
});

describe('errorResponse', () => {
  it('produces a valid response that carries the reason', () => {
    // Failures cross the boundary as data. A rejected promise across chrome.runtime
    // loses the reason, and "something went wrong" is not a diagnosable notice.
    const res = errorResponse('no key configured');
    expect(isWorkerResponse(res)).toBe(true);
    expect(res).toEqual({ kind: 'error', reason: 'no key configured' });
  });
});

describe('the protocol round-trips', () => {
  it('survives structured-clone-equivalent serialisation', () => {
    const req: ContentRequest = { kind: 'score', posts: [rawPost()] };
    const round = JSON.parse(JSON.stringify(req));
    expect(isContentRequest(round)).toBe(true);
    expect(round).toEqual(req);
  });

  it('survives a scored response round-trip', () => {
    const res: WorkerResponse = { kind: 'scored', posts: [scored('1', { bait: 0.5 })] };
    const round = JSON.parse(JSON.stringify(res));
    expect(isWorkerResponse(round)).toBe(true);
    expect(round).toEqual(res);
  });
});
