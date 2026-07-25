/** @type {import('next').NextConfig} */
const path = require('path')

const nextConfig = {
  // Self-contained server output for Docker/Railway. In this pnpm monorepo,
  // Next traces from the repo root and emits the server at
  // `.next/standalone/apps/web/server.js` (see deploy/web.Dockerfile).
  output: 'standalone',
  // Pin the file-tracing root to the monorepo root so the standalone bundle
  // includes the workspace packages and node_modules. Silences the
  // "multiple lockfiles" inference warning. (Top-level in Next 15; under
  // `experimental` in 14.2.)
  experimental: {
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
  transpilePackages: ['@workspace/ui', '@workspace/shared'],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig
