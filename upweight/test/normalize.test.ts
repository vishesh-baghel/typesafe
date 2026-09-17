import { describe, expect, it } from 'vitest';
import {
  cleanComment,
  COMMENT_MAX_CHARS,
  decodeEntities,
  sourceOf,
  stripHtml,
  truncate,
} from '../lib/normalize';

describe('decodeEntities', () => {
  it('decodes the named entities HN actually emits', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe('a & b <c> "d"');
  });

  it('decodes numeric and hex entities', () => {
    expect(decodeEntities('&#x27;quoted&#x27;')).toBe("'quoted'");
    expect(decodeEntities('&#39;also&#39;')).toBe("'also'");
    expect(decodeEntities('&#8212;')).toBe('—');
  });

  it('leaves unknown entities alone rather than mangling them', () => {
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;');
  });

  it('drops out-of-range code points instead of throwing', () => {
    expect(() => decodeEntities('&#1114112;')).not.toThrow();
    expect(decodeEntities('&#1114112;')).toBe('');
  });
});

describe('stripHtml', () => {
  it('turns paragraph tags into breaks before stripping, so sentences do not run together', () => {
    expect(stripHtml('<p>One.</p><p>Two.</p>')).toContain('One.\n\n');
    expect(stripHtml('<p>One.</p><p>Two.</p>').replace(/\n+/g, ' ').trim()).toBe('One. Two.');
  });

  it('handles br tags', () => {
    expect(stripHtml('a<br>b').trim()).toBe('a\nb');
    expect(stripHtml('a<br />b').trim()).toBe('a\nb');
  });

  it('removes anchors but keeps their text', () => {
    expect(stripHtml('see <a href="https://x.test" rel="nofollow">this</a> link')).toBe(
      'see this link',
    );
  });
});

describe('truncate', () => {
  it('leaves short input untouched', () => {
    expect(truncate('short', 100)).toBe('short');
  });

  it('cuts at a word boundary and marks the cut', () => {
    const src = 'alpha beta gamma delta epsilon';
    const out = truncate(src, 20);
    expect(out.endsWith('...')).toBe(true);
    // The kept text must be whole words from the source, never a split word.
    const kept = out.slice(0, -3);
    expect(src.startsWith(kept)).toBe(true);
    expect(src[kept.length] === ' ' || kept.length === src.length).toBe(true);
  });

  it('falls back to a hard cut when there is no usable boundary', () => {
    const out = truncate('a'.repeat(50), 20);
    expect(out).toBe('a'.repeat(20) + '...');
  });
});

describe('cleanComment', () => {
  it('returns null for nullish or empty input', () => {
    expect(cleanComment(undefined)).toBeNull();
    expect(cleanComment(null)).toBeNull();
    expect(cleanComment('')).toBeNull();
    expect(cleanComment('   ')).toBeNull();
  });

  it('returns null when only markup survives, so empty comments are dropped not kept', () => {
    expect(cleanComment('<p></p><p>  </p>')).toBeNull();
  });

  it('runs the full pipeline: strip, decode, collapse', () => {
    const out = cleanComment('<p>It&#x27;s   <i>fine</i>.</p><p>Really.</p>');
    expect(out).toBe("It's fine.\n\nReally.");
  });

  it('caps at the comment budget', () => {
    const out = cleanComment('word '.repeat(500));
    expect(out!.length).toBeLessThanOrEqual(COMMENT_MAX_CHARS + 3);
  });
});

describe('sourceOf', () => {
  it('strips www', () => {
    expect(sourceOf('https://www.example.com/a/b', 'T')).toBe('example.com');
  });

  it('keeps meaningful subdomains', () => {
    expect(sourceOf('https://blog.example.co.uk/x', 'T')).toBe('blog.example.co.uk');
  });

  it('labels text posts from their title prefix', () => {
    expect(sourceOf(undefined, 'Ask HN: anything?')).toBe('Ask HN');
    expect(sourceOf(undefined, 'Show HN: a thing')).toBe('Show HN');
    expect(sourceOf(undefined, 'Just a title')).toBe('news.ycombinator.com');
  });

  it('does not throw on an unparseable url', () => {
    expect(sourceOf('not a url', 'T')).toBe('news.ycombinator.com');
  });
});
