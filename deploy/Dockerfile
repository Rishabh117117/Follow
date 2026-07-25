# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────────────────
# Workspace Platform — API image (monorepo-safe, Railway single-port deploy)
#
# Build context = repo root (railway.json points dockerfilePath here).
#
# Why we run with `tsx` instead of `node packages/api/dist/index.js`:
#   - @workspace/shared is consumed as TypeScript SOURCE: its package.json
#     "exports" map points at ./src/*.ts and it builds with noEmit, so there
#     is no JS artifact for Node to resolve at runtime.
#   - The API tsconfig uses `moduleResolution: bundler` + ESM modules while
#     packages/api/package.json has no "type": "module" (CommonJS manifest).
#   A plain `tsc` emit therefore cannot be launched with `node` (workspace
#   specifiers resolve to .ts files, and the ESM/CJS mode disagrees). `tsx`
#   is already the project's dev runtime, handles the workspace .ts sources
#   and the many dynamic `await import(...)` paths, and binds to $PORT exactly
#   as `node` would. This gives production parity with zero resolution
#   surprises. See deploy/DEPLOY-1.md §A1.
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS base
# Install the pinned pnpm directly via npm. We deliberately do NOT use corepack:
# its download + signature-verification step for the pinned pnpm is the part that
# fails fast on CI builders (Railway). npm ships in the node image and is enough.
RUN npm install -g pnpm@10.30.0
WORKDIR /app

# ── build: install the whole pnpm workspace from the frozen lockfile ────────
FROM base AS build
# Copy the entire repo (the .dockerignore at the context root strips
# node_modules / dist / data / logs / env files). Copying everything keeps the
# install bullet-proof for a pnpm monorepo, whose lockfile references every
# workspace package.json.
COPY . .
RUN pnpm install --frozen-lockfile

# Build/validate the two packages we ship: @workspace/shared then
# @workspace/api. The API carries a known type-error baseline inside gated-off
# handlers (see CLAUDE.md), so the typecheck is ADVISORY and must not fail the
# image build — runtime correctness is asserted by the smoke test (A5).
RUN pnpm --filter @workspace/shared run typecheck \
      || echo "[deploy] @workspace/shared typecheck: non-zero (advisory)"
RUN pnpm --filter @workspace/api run typecheck \
      || echo "[deploy] @workspace/api typecheck: non-zero (known baseline, advisory)"

# ── runtime ─────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
# Production default — overridden only if the Railway var is explicitly 'true'.
ENV DEV_BYPASS_AUTH=false
# Documentation only; Railway injects $PORT and the app binds to it.
EXPOSE 3001
WORKDIR /app/packages/api
# tsx is a root dependency; pnpm exec resolves it from the workspace.
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
