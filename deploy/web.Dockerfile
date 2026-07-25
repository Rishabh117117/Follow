# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────────────────
# Workspace Platform — WEB image (Next.js 14 App Router, standalone output)
#
# Build context = repo root (deploy/web.railway.json points dockerfilePath
# here). This is a SECOND Railway service; the API keeps deploy/Dockerfile.
#
# Why standalone + plain `node` (unlike the API, which runs via tsx):
#   `next build` with `output: 'standalone'` traces the exact runtime deps and
#   emits a self-contained server. With `experimental.outputFileTracingRoot`
#   pinned to the monorepo root, the server is emitted at
#   `apps/web/server.js` inside `.next/standalone/`, with traced node_modules
#   bundled alongside — so the runner needs neither pnpm nor a workspace
#   install. `next build` also transpiles the workspace packages
#   (@workspace/ui|shared|canvas) via `transpilePackages`.
#
# Strict build: next.config has eslint.ignoreDuringBuilds=false +
# typescript.ignoreBuildErrors=false. Web's TS baseline is 0, so the build
# must stay green; a TS/eslint failure here is a real regression to fix, NOT
# something to silence. See docs/audits/WEB-DEPLOY-1-REPORT.md.
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS base
# Install the pinned pnpm directly via npm. We deliberately do NOT use corepack:
# its download + signature-verification step fails fast on Railway's builder.
RUN npm install -g pnpm@10.30.0
WORKDIR /app

# ── build: install the whole pnpm workspace + run next build ────────────────
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined into the CLIENT bundle at `next build` time,
# not read at runtime. Railway exposes service variables to a Dockerfile build
# only when the build declares matching ARGs — so declare them and promote to
# ENV before the build. Without this, the browser bundle has no API URL and
# falls back to localhost/same-origin → "Could not reach the API" on client
# calls (while server-side calls, which use the runtime env, still work).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_URL
ARG NEXT_PUBLIC_DEV_BYPASS_AUTH
ARG NEXT_PUBLIC_LAUNCHER_URL
ARG NEXT_PUBLIC_YJS_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL
ENV NEXT_PUBLIC_DEV_BYPASS_AUTH=$NEXT_PUBLIC_DEV_BYPASS_AUTH
ENV NEXT_PUBLIC_LAUNCHER_URL=$NEXT_PUBLIC_LAUNCHER_URL
ENV NEXT_PUBLIC_YJS_WS_URL=$NEXT_PUBLIC_YJS_WS_URL
# Copy the entire repo (the root .dockerignore strips node_modules / .next /
# dist / data / logs / env files). A pnpm monorepo's frozen install needs every
# workspace package.json present, so copy everything.
COPY . .
RUN pnpm install --frozen-lockfile
# Produces apps/web/.next/standalone (server + traced node_modules) and
# apps/web/.next/static. Strict — fails the image on any TS/eslint error.
RUN pnpm --filter @workspace/web build

# ── runtime: copy only the standalone bundle (no pnpm, no install) ──────────
FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server reads PORT + HOSTNAME. Bind all interfaces so
# Railway's proxy can reach it; Railway injects the real $PORT at runtime.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone root (server.js, package.json, traced node_modules). Monorepo
# layout nests the app under apps/web/, so server.js is apps/web/server.js.
COPY --from=build /app/apps/web/.next/standalone ./
# Static assets + public/ are NOT part of standalone — copy them into the
# nested app dir so the server serves them at the expected paths.
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
