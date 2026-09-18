import { describe, expect, it } from 'vitest';
import {
  collapseWhitespace,
  decodeEntities,
  normalizeBody,
  senderDomain,
  stripNonContentElements,
  stripQuotedReply,
  stripTags,
  structuralTagsToNewlines,
  truncate,
} from '../lib/normalize';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeEntities('&#65;&#66;')).toBe('AB');
    expect(decodeEntities('&#x41;&#x42;')).toBe('AB');
  });
  it('leaves unknown entities alone rather than eating them', () => {
    expect(decodeEntities('&notanentity; x')).toBe('&notanentity; x');
  });
  it('survives an out-of-range code point', () => {
    expect(decodeEntities('&#99999999;')).toBe('');
  });
});

describe('element stripping', () => {
  it('removes style and script content entirely, not just the tags', () => {
    const out = stripNonContentElements('<style>.a{color:red}</style>keep<script>alert(1)</script>');
    expect(out).not.toContain('color:red');
    expect(out).not.toContain('alert');
    expect(out).toContain('keep');
  });
  it('turns block markup into newlines', () => {
    expect(structuralTagsToNewlines('a<br>b<p>c</p>')).toBe('a\nb\nc\n');
  });
  it('strips remaining tags', () => {
    expect(stripTags('<a href="#">x</a>').trim()).toBe('x');
  });
});

describe('stripQuotedReply', () => {
  it('cuts at an attribution line', () => {
    const out = stripQuotedReply('my reply\nOn Tue, someone wrote:\nold stuff');
    expect(out).toContain('my reply');
    expect(out).not.toContain('old stuff');
  });
  it('cuts at a run of quoted lines but not a single one', () => {
    expect(stripQuotedReply('new\n> one\n> two\nold')).toBe('new\n');
    expect(stripQuotedReply('a > b is a comparison')).toBe('a > b is a comparison');
  });
  it('cuts at a forwarded-message separator', () => {
    expect(stripQuotedReply('note\n---- Original Message ----\nold')).toBe('note\n');
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('short', 100)).toBe('short');
  });
  it('cuts at a word boundary when one is close to the limit', () => {
    const out = truncate('aaaa bbbb cccc dddd eeee', 12);
    expect(out.endsWith('...')).toBe(true);
    expect(out).not.toContain('cccc');
  });
  it('cuts mid-word rather than losing most of the budget', () => {
    const out = truncate('a'.repeat(50), 10);
    expect(out).toBe('a'.repeat(10) + '...');
  });
});

describe('normalizeBody order', () => {
  it('truncates LAST, so a cut never lands inside markup', () => {
    // If truncation ran before tag stripping, the cut would land inside the <div ...> attribute.
    const raw = `<div data-x="${'y'.repeat(200)}">real content here</div>`;
    const out = normalizeBody(raw, 40);
    expect(out).not.toContain('<');
    expect(out).not.toContain('data-x');
    expect(out).toContain('real content');
  });

  it('strips markup that only appears after entity decoding', () => {
    const out = normalizeBody('before &lt;b&gt;bold&lt;/b&gt; after');
    expect(out).not.toContain('<b>');
    expect(out).toContain('bold');
  });

  it('returns empty string for null, undefined and empty input', () => {
    expect(normalizeBody(null)).toBe('');
    expect(normalizeBody(undefined)).toBe('');
    expect(normalizeBody('')).toBe('');
    expect(normalizeBody('   <p></p>  ')).toBe('');
  });

  it('collapses runs of whitespace and blank lines', () => {
    expect(collapseWhitespace('a   b\n\n\n\nc')).toBe('a b\n\nc');
  });
});

describe('senderDomain', () => {
  it('takes the registrable-looking tail', () => {
    expect(senderDomain('no-reply@mail.example.com')).toBe('example.com');
    expect(senderDomain('a@example.com')).toBe('example.com');
    expect(senderDomain('x@localhost')).toBe('localhost');
  });
  it('returns empty for a malformed address rather than throwing', () => {
    expect(senderDomain('not-an-address')).toBe('');
  });
});
