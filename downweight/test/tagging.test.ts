// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTag,
  CARD_CLASS,
  CHOSEN_CLASS,
  ensureLabelControls,
  LABEL_CLASS,
  OVERLAY_CLASS,
  clearTag,
  DIM_CLASS,
  disable,
  enable,
  injectStyles,
  isEnabled,
  ROOT_CLASS,
  setDimmed,
  STYLE_ID,
  TAG_CLASS,
  teardown,
} from '../lib/tagging';
import { card, timeline } from './fixtures';

const mount = (html: string) => {
  document.documentElement.className = '';
  document.body.innerHTML = html;
  document.getElementById(STYLE_ID)?.remove();
  return document.querySelector<HTMLElement>('article[data-testid="tweet"]')!;
};

beforeEach(() => {
  document.documentElement.className = '';
  document.body.innerHTML = '';
  document.getElementById(STYLE_ID)?.remove();
});

describe('enable and disable', () => {
  it('turns everything on with one class', () => {
    enable(document);
    expect(isEnabled(document)).toBe(true);
    expect(document.documentElement.classList.contains(ROOT_CLASS)).toBe(true);
  });

  it('turns everything off with one class, without touching the cards', () => {
    const el = mount(card());
    enable(document);
    applyTag(el, 'bait');
    disable(document);

    expect(isEnabled(document)).toBe(false);
    // The tag element is still in the DOM but every rule is scoped under the root class,
    // so nothing renders. This is what makes the kill switch instant.
    expect(el.querySelector(`.${TAG_CLASS}`)).not.toBeNull();
  });

  it('injects the stylesheet exactly once', () => {
    injectStyles(document);
    injectStyles(document);
    injectStyles(document);
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
  });

  it('scopes every rule under the root class', () => {
    // If a rule escapes the scope, disabling stops being a complete off switch.
    injectStyles(document);
    const css = document.getElementById(STYLE_ID)!.textContent!;
    for (const rule of css.split('}').map((r) => r.trim()).filter(Boolean)) {
      expect(rule).toContain(`.${ROOT_CLASS}`);
    }
  });
});

describe('applyTag', () => {
  it('adds a tag carrying the word', () => {
    const el = mount(card());
    applyTag(el, 'slop');
    expect(el.querySelector(`.${TAG_CLASS}`)!.textContent).toBe('slop');
  });

  it('makes the card a positioning context', () => {
    const el = mount(card());
    applyTag(el, 'bait');
    expect(el.classList.contains(CARD_CLASS)).toBe(true);
  });

  it('is idempotent, so a re-render cannot stack tags', () => {
    // X re-renders the same card constantly and a slider drag retags every visible post.
    const el = mount(card());
    applyTag(el, 'bait');
    applyTag(el, 'bait');
    applyTag(el, 'bait');
    expect(el.querySelectorAll(`.${TAG_CLASS}`)).toHaveLength(1);
  });

  it('emits no DOM mutation when re-applied unchanged', async () => {
    // The precise regression. The content script re-paints from a MutationObserver on the
    // timeline, so a paint that mutates makes the observer fire, which paints again, which
    // mutates: an infinite loop that pegs the tab. Being idempotent in the DOM it produces
    // is not enough; it has to emit no mutation record at all.
    const el = mount(card());
    applyTag(el, 'bait', 'scored on 6 of 6');

    const records: MutationRecord[] = [];
    const obs = new MutationObserver((rs) => records.push(...rs));
    obs.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });

    applyTag(el, 'bait', 'scored on 6 of 6');
    applyTag(el, 'bait', 'scored on 6 of 6');
    await new Promise((r) => setTimeout(r, 0));
    obs.disconnect();

    expect(records).toEqual([]);
  });

  it('does emit a mutation when the verdict actually changes', async () => {
    // The other half: suppressing writes must not suppress real updates.
    const el = mount(card());
    applyTag(el, 'bait');

    const records: MutationRecord[] = [];
    const obs = new MutationObserver((rs) => records.push(...rs));
    obs.observe(el, { childList: true, subtree: true, characterData: true });

    applyTag(el, 'promo');
    await new Promise((r) => setTimeout(r, 0));
    obs.disconnect();

    expect(records.length).toBeGreaterThan(0);
    expect(el.querySelector(`.${TAG_CLASS}`)!.textContent).toBe('promo');
  });

  it('updates the word in place when the verdict changes', () => {
    const el = mount(card());
    applyTag(el, 'bait');
    applyTag(el, 'promo');
    expect(el.querySelectorAll(`.${TAG_CLASS}`)).toHaveLength(1);
    expect(el.querySelector(`.${TAG_CLASS}`)!.textContent).toBe('promo');
  });

  it('carries the scored-on detail on hover', () => {
    const el = mount(card());
    applyTag(el, 'bait', 'scored on 4 of 6');
    expect(el.querySelector(`.${TAG_CLASS}`)!.getAttribute('title')).toBe('scored on 4 of 6');
  });

  it('drops a stale detail rather than leaving the old one', () => {
    const el = mount(card());
    applyTag(el, 'bait', 'scored on 4 of 6');
    applyTag(el, 'bait');
    expect(el.querySelector(`.${TAG_CLASS}`)!.hasAttribute('title')).toBe(false);
  });

  it('is hidden from assistive technology and cannot swallow a click', () => {
    const el = mount(card());
    const tag = applyTag(el, 'bait');
    expect(tag.getAttribute('aria-hidden')).toBe('true');
    // pointer-events is set in the stylesheet rather than inline; assert the rule exists.
    injectStyles(document);
    expect(document.getElementById(STYLE_ID)!.textContent).toContain('pointer-events: none');
  });

  it('does not touch a nested quoted card', () => {
    const el = mount(card({ quote: { handle: 'other', text: 'their point' } }));
    applyTag(el, 'bait');
    // :scope > guards against the tag being found inside, or applied to, the quote.
    expect(el.querySelectorAll(`.${TAG_CLASS}`)).toHaveLength(1);
    expect(el.querySelector('div[role="link"]')!.querySelector(`.${TAG_CLASS}`)).toBeNull();
  });
});

describe('clearTag', () => {
  it('removes the verdict but leaves the overlay, which is not a verdict', () => {
    // The label buttons live in the same overlay and outlive any particular judgment.
    // Tearing the overlay down here would make them vanish whenever a post stopped
    // crossing the threshold, which is exactly when you might want to disagree with it.
    const el = mount(card());
    ensureLabelControls(el, () => {});
    applyTag(el, 'bait');
    clearTag(el);

    expect(el.querySelector(`.${TAG_CLASS}`)).toBeNull();
    expect(el.querySelectorAll(`.${LABEL_CLASS}`)).toHaveLength(2);
    expect(el.classList.contains(CARD_CLASS)).toBe(true);
  });

  it('is safe on a card that was never tagged', () => {
    const el = mount(card());
    expect(() => clearTag(el)).not.toThrow();
  });
});

describe('setDimmed', () => {
  it('toggles the dim class and nothing else', () => {
    const el = mount(card());
    const before = el.className;

    setDimmed(el, true);
    expect(el.classList.contains(DIM_CLASS)).toBe(true);

    setDimmed(el, false);
    expect(el.classList.contains(DIM_CLASS)).toBe(false);
    expect(el.className).toBe(before);
  });

  it('changes opacity only, never layout', () => {
    // The reason dimming was safe to ship where collapsing was not. Assert the rule is an
    // opacity rule and carries nothing that could move the card.
    injectStyles(document);
    const css = document.getElementById(STYLE_ID)!.textContent!;
    const dimRule = css.split('}').find((r) => r.includes(DIM_CLASS) && !r.includes(':hover'))!;
    expect(dimRule).toContain('opacity');
    for (const forbidden of ['display', 'height', 'margin', 'padding', 'position', 'transform']) {
      expect(dimRule).not.toContain(forbidden);
    }
  });

  it('is independent of tagging', () => {
    const el = mount(card());
    setDimmed(el, true);
    expect(el.querySelector(`.${TAG_CLASS}`)).toBeNull();
  });
});

describe('teardown leaves a normal timeline behind', () => {
  it('removes every trace across every card', () => {
    document.body.innerHTML = timeline(card({ id: '1' }), card({ id: '2' }), card({ id: '3' }));
    enable(document);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('article'))) {
      applyTag(el, 'bait', 'scored on 6 of 6');
      setDimmed(el, true);
    }

    teardown(document);

    expect(document.querySelectorAll(`.${TAG_CLASS}`)).toHaveLength(0);
    expect(document.querySelectorAll(`.${CARD_CLASS}`)).toHaveLength(0);
    expect(document.querySelectorAll(`.${DIM_CLASS}`)).toHaveLength(0);
    expect(isEnabled(document)).toBe(false);
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it('leaves X’s own markup untouched', () => {
    const original = timeline(card({ id: '1' }), card({ id: '2' }));
    document.body.innerHTML = original;
    const before = document.body.innerHTML;

    enable(document);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('article'))) {
      applyTag(el, 'slop');
      setDimmed(el, true);
    }
    teardown(document);

    expect(document.body.innerHTML).toBe(before);
  });

  it('is safe on a timeline that was never touched', () => {
    document.body.innerHTML = timeline(card());
    expect(() => teardown(document)).not.toThrow();
  });

  it('works on a subtree without needing the document', () => {
    document.body.innerHTML = timeline(card());
    const el = document.querySelector<HTMLElement>('article')!;
    applyTag(el, 'bait');
    teardown(document.body);
    expect(document.querySelectorAll(`.${TAG_CLASS}`)).toHaveLength(0);
  });
});

describe('ensureLabelControls', () => {
  it('adds keep and hide', () => {
    const el = mount(card());
    ensureLabelControls(el, () => {});
    expect([...el.querySelectorAll(`.${LABEL_CLASS}`)].map((b) => b.textContent)).toEqual(['keep', 'hide']);
  });

  it('is idempotent, so a repaint cannot stack buttons', () => {
    const el = mount(card());
    for (let i = 0; i < 5; i++) ensureLabelControls(el, () => {});
    expect(el.querySelectorAll(`.${LABEL_CLASS}`)).toHaveLength(2);
  });

  it('emits no mutation when re-applied unchanged', async () => {
    // Same rule as the tag: the content script repaints from a MutationObserver, so a
    // paint that mutates restarts the loop.
    const el = mount(card());
    ensureLabelControls(el, () => {}, 'hide');

    const records: MutationRecord[] = [];
    const obs = new MutationObserver((rs) => records.push(...rs));
    obs.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
    ensureLabelControls(el, () => {}, 'hide');
    ensureLabelControls(el, () => {}, 'hide');
    await new Promise((r) => setTimeout(r, 0));
    obs.disconnect();

    expect(records).toEqual([]);
  });

  it('reports the click', () => {
    const el = mount(card());
    const seen: string[] = [];
    ensureLabelControls(el, (l) => seen.push(l));
    el.querySelector<HTMLButtonElement>(`.${LABEL_CLASS}[data-dw="hide"]`)!.click();
    el.querySelector<HTMLButtonElement>(`.${LABEL_CLASS}[data-dw="keep"]`)!.click();
    expect(seen).toEqual(['hide', 'keep']);
  });

  it('does not let a label click navigate to the post', () => {
    // Every card on X is a link. Without preventDefault this opens the post instead.
    const el = mount(card());
    let navigated = false;
    el.addEventListener('click', (e) => {
      if (!e.defaultPrevented) navigated = true;
    });
    ensureLabelControls(el, () => {});
    el.querySelector<HTMLButtonElement>(`.${LABEL_CLASS}[data-dw="keep"]`)!.click();
    expect(navigated).toBe(false);
  });

  it('marks the chosen label, and only that one', () => {
    const el = mount(card());
    ensureLabelControls(el, () => {}, 'keep');
    const keep = el.querySelector(`.${LABEL_CLASS}[data-dw="keep"]`)!;
    const hide = el.querySelector(`.${LABEL_CLASS}[data-dw="hide"]`)!;
    expect(keep.classList.contains(CHOSEN_CLASS)).toBe(true);
    expect(hide.classList.contains(CHOSEN_CLASS)).toBe(false);
    expect(keep.getAttribute('aria-pressed')).toBe('true');
  });

  it('moves the mark when the verdict changes', () => {
    const el = mount(card());
    ensureLabelControls(el, () => {}, 'keep');
    ensureLabelControls(el, () => {}, 'hide');
    expect(el.querySelector(`.${LABEL_CLASS}[data-dw="keep"]`)!.classList.contains(CHOSEN_CLASS)).toBe(false);
    expect(el.querySelector(`.${LABEL_CLASS}[data-dw="hide"]`)!.classList.contains(CHOSEN_CLASS)).toBe(true);
  });

  it('shares one overlay with the tag', () => {
    const el = mount(card());
    ensureLabelControls(el, () => {});
    applyTag(el, 'bait');
    expect(el.querySelectorAll(`.${OVERLAY_CLASS}`)).toHaveLength(1);
    // keep / hide / verdict, in that order.
    const row = [...el.querySelector(`.${OVERLAY_CLASS}`)!.children].map((c) => c.textContent);
    expect(row).toEqual(['keep', 'hide', 'bait']);
  });
});
