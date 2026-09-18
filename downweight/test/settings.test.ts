import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLD, DEFAULT_WEIGHTS } from '../lib/composite';
import { DIM_KEYS } from '../lib/types';
import { DEFAULTS, normalise } from '../extension/src/settings';

/**
 * `chrome.storage.local` is a JSON blob the extension does not fully control: it survives
 * upgrades, it can be edited by anyone with devtools on the extension page, and it can
 * hold a shape written by an older version. `normalise` is the only thing between that
 * blob and the tagging maths, so a NaN getting through here would produce a NaN composite
 * and a timeline that tags nothing with no visible reason why.
 */
describe('normalise: storage is untrusted input', () => {
  it('returns the defaults for an empty store', () => {
    expect(normalise({})).toEqual(DEFAULTS);
  });

  it('returns the defaults for junk', () => {
    for (const junk of [null, undefined, 42, 'settings', []]) {
      expect(normalise(junk)).toEqual(DEFAULTS);
    }
  });

  it('keeps a valid stored value', () => {
    const out = normalise({ apiKey: 'sk-abc', threshold: 0.6, dimming: true, enabled: false });
    expect(out.apiKey).toBe('sk-abc');
    expect(out.threshold).toBe(0.6);
    expect(out.dimming).toBe(true);
    expect(out.enabled).toBe(false);
  });

  it('trims a pasted key, since a trailing newline is the classic paste error', () => {
    expect(normalise({ apiKey: '  sk-abc\n' }).apiKey).toBe('sk-abc');
  });

  it('treats a non-string key as absent rather than coercing it', () => {
    expect(normalise({ apiKey: 12345 }).apiKey).toBe('');
    expect(normalise({ apiKey: null }).apiKey).toBe('');
  });

  it('clamps out-of-range weights instead of trusting them', () => {
    const out = normalise({ weights: { bait: 9999, subst: -9999 } });
    expect(out.weights.bait).toBe(100);
    expect(out.weights.subst).toBe(-100);
  });

  it('never lets a non-finite weight through', () => {
    const out = normalise({ weights: { bait: Number.NaN, slop: Number.POSITIVE_INFINITY } });
    expect(out.weights.bait).toBe(0);
    expect(out.weights.slop).toBe(0);
    for (const key of DIM_KEYS) expect(Number.isFinite(out.weights[key])).toBe(true);
  });

  it('fills missing dimensions from the defaults rather than leaving them undefined', () => {
    // The shape after adding a seventh dimension to a reader's existing install.
    const out = normalise({ weights: { bait: 10 } });
    expect(out.weights.bait).toBe(10);
    expect(out.weights.rage).toBe(DEFAULT_WEIGHTS.rage);
    for (const key of DIM_KEYS) expect(typeof out.weights[key]).toBe('number');
  });

  it('ignores weight entries that are not numbers', () => {
    const out = normalise({ weights: { bait: 'lots', slop: null, promo: {} } });
    expect(out.weights.bait).toBe(DEFAULT_WEIGHTS.bait);
    expect(out.weights.slop).toBe(DEFAULT_WEIGHTS.slop);
    expect(out.weights.promo).toBe(DEFAULT_WEIGHTS.promo);
  });

  it('ignores a weights value that is not an object at all', () => {
    expect(normalise({ weights: 'all of them' }).weights).toEqual(DEFAULT_WEIGHTS);
    expect(normalise({ weights: null }).weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('clamps the threshold and falls back when it is not a number', () => {
    expect(normalise({ threshold: 99 }).threshold).toBe(1);
    expect(normalise({ threshold: -99 }).threshold).toBe(-1);
    expect(normalise({ threshold: 'high' }).threshold).toBe(DEFAULT_THRESHOLD);
    expect(normalise({ threshold: Number.NaN }).threshold).toBe(DEFAULT_THRESHOLD);
  });

  it('defaults dimming off, and only a real true turns it on', () => {
    // Opt-in is the promise. A truthy string out of a corrupted store must not enable it.
    expect(normalise({}).dimming).toBe(false);
    expect(normalise({ dimming: 'yes' }).dimming).toBe(false);
    expect(normalise({ dimming: 1 }).dimming).toBe(false);
    expect(normalise({ dimming: true }).dimming).toBe(true);
  });

  it('defaults enabled on, and only a real false turns it off', () => {
    // The opposite default to dimming, deliberately: a garbled store should leave the
    // extension working, not silently dead with no error to explain it.
    expect(normalise({}).enabled).toBe(true);
    expect(normalise({ enabled: 'no' }).enabled).toBe(true);
    expect(normalise({ enabled: undefined }).enabled).toBe(true);
    expect(normalise({ enabled: false }).enabled).toBe(false);
  });

  it('is idempotent', () => {
    const once = normalise({ apiKey: ' k ', weights: { bait: 999 }, threshold: 5 });
    expect(normalise(once)).toEqual(once);
  });

  it('does not mutate the defaults it copies from', () => {
    normalise({ weights: { bait: 7 } });
    expect(DEFAULT_WEIGHTS.bait).not.toBe(7);
    expect(DEFAULTS.weights.bait).not.toBe(7);
  });
});
