import { describe, expect, it } from 'vitest';
import { extractText } from '../lib/article';
import { mapLimit } from '../lib/hn';

describe('mapLimit', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapLimit([30, 10, 20, 0], 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('never exceeds the limit', async () => {
    let inFlight = 0, peak = 0;
    await mapLimit(Array.from({ length: 20 }), 4, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list without hanging', async () => {
    expect(await mapLimit([], 8, async () => 1)).toEqual([]);
  });

  it('handles a limit larger than the list', async () => {
    expect(await mapLimit([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });
});

describe('extractText', () => {
  it('removes scripts and styles entirely, including their contents', () => {
    const out = extractText('<p>keep</p><script>var secret=1</script><style>.a{}</style>');
    expect(out).toContain('keep');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('.a{}');
  });

  it('removes page furniture so it never reaches the model', () => {
    const out = extractText(
      '<nav>Home About</nav><header>Subscribe now</header><p>Real content.</p><footer>Copyright</footer>',
    );
    expect(out).toBe('Real content.');
  });

  it('strips comments', () => {
    expect(extractText('<p>a</p><!-- hidden -->')).toBe('a');
  });

  it('collapses whitespace', () => {
    expect(extractText('<p>a</p>\n\n\n   <p>b</p>')).toBe('a b');
  });

  it('decodes entities in article text', () => {
    expect(extractText('<p>Tom&#x27;s &amp; Jerry</p>')).toBe("Tom's & Jerry");
  });

  it('drops svg blocks, which are otherwise a source of junk tokens', () => {
    expect(extractText('<p>x</p><svg><path d="M0 0"/></svg>')).toBe('x');
  });
});
