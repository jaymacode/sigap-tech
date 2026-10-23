import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Next.js config.
 * - `output: 'standalone'` disiapkan untuk image Docker (CICD.md §6) walau Docker belum dikerjakan.
 * - `poweredByHeader: false` mengurangi fingerprinting.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname),
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    APP_VERSION: process.env.APP_VERSION ?? 'dev',
  },
};

export default nextConfig;
