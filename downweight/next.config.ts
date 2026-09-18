import type { NextConfig } from 'next';

/**
 * The sample-corpus demo only. The extension is built by tsup and Next never sees it,
 * because nothing under `app/` imports from `extension/`.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
