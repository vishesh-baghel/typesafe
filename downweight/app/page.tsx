/**
 * Placeholder. The sample-corpus demo is Phase 3 work.
 *
 * It exists now so `pnpm build` and `pnpm dev` are real from Phase 0 onward, which is
 * what keeps the Vercel Root Directory setup verifiable before there is anything worth
 * deploying.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: '64ch', margin: '0 auto', padding: 'var(--space-2xl) var(--space-lg)' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', margin: 0 }}>
        Downweight
      </h1>
      <p style={{ color: 'var(--color-ink-2)', marginTop: 'var(--space-sm)' }}>
        Tags engagement bait, AI slop and self-promotion on X. Your key, your browser, no server.
      </p>
      <p style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-sm)' }}>
        The sample-corpus demo lands in Phase 3, after the Phase 1 judgment gate. Until the gate
        passes there is nothing here worth showing, which is the point of having a gate.
      </p>
    </main>
  );
}
