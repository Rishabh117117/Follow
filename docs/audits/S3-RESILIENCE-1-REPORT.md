# S3-RESILIENCE-1 — self-heal the storage bucket on `NoSuchBucket`

**Date:** 2026-06-21 · **Branch:** `claude/s3-resilience-1` (PR → `main`) ·
**Status:** ✅ self-heal implemented + unit-verified · ✅ gates green · ⚠️
durability finding: **MinIO is on ephemeral storage (no Railway volume)** —
filed as **S3-DURABLE-1** (infra, not this sprint).

**One-line:** the raw-file upload path now **auto-recovers** when the MinIO
bucket has vanished — it recreates the bucket and retries the upload once,
in-process, instead of failing `NoSuchBucket` forever until an API restart.

---

## Problem

Indexing has broken **three times** on the S3/MinIO seam (creds → creds → the
bucket `follow` itself disappeared). The bucket-disappearance failure mode is
structural:

`lib/s3.ts` memoises bucket provisioning:

```ts
let bucketReady: Promise<void> | null = null
function ensureBucket() {
  if (bucketReady) return bucketReady   // ← cached forever after first success
  bucketReady = (async () => { HeadBucket … else CreateBucket … })()
  return bucketReady
}
```

`ensureBucket()` runs once per process. After the first success `bucketReady` is
a resolved promise that is **never re-evaluated**. So when MinIO resets and drops
the bucket, every subsequent `uploadBuffer()` → `PutObjectCommand` fails
`NoSuchBucket` **forever**, and the only recovery is restarting the API. For a
memory product whose raw-file ingestion is the provenance layer, that's fragile.

The hot caller is `services/raw-file-store/store.ts` → `uploadBuffer()` (the
`raw_files` cloud-upload path; the error propagates, it is not swallowed), so a
dead bucket silently kills raw-file indexing.

## Fix (`packages/api/src/lib/s3.ts`)

1. **`resetBucketReady()`** — clears the `bucketReady` memo so the next
   `ensureBucket()` actually re-runs `HeadBucket → CreateBucket` instead of
   returning the cached "ready". This makes `ensureBucket()` re-runnable
   (acceptance #2).
2. **`isBucketMissing(err)`** — classifies an error as bucket-missing:
   `NoSuchBucket` / `NoSuchKey`-class `name`/`Code`, or HTTP `404` in
   `$metadata`. Deliberately narrow so transient/auth errors (e.g.
   `AccessDenied`) are **not** mistaken for a missing bucket.
3. **`uploadBuffer()` self-heal** — wraps the `PutObject` send:

   ```ts
   try {
     await put()
   } catch (err) {
     if (!isBucketMissing(err)) throw err // non-bucket → surface as-is
     resetBucketReady() // drop the stale memo
     await ensureBucket() // recreate the bucket
     await put() // retry exactly once
   }
   ```

   If the retry also fails, the real error propagates (no swallowing).

`getUploadUrl()` (presigned) is intentionally **not** changed: it only signs a
URL server-side and never sends a `PutObject`, so the actual upload happens
client-side where this server-side retry can't apply. The recreated bucket from
any `uploadBuffer` self-heal does benefit it (shared memo). The indexing-critical
path is `uploadBuffer`, which is fixed.

## Verification (acceptance #1, #3)

Chosen path: **focused unit test** (`src/lib/__tests__/s3-resilience.test.ts`),
not a live induce. Deleting the live prod `follow` bucket to test would disrupt
the running product (and a concurrent session), so the deterministic mock is the
safe, repeatable proof. The AWS SDK is mocked; a programmable `send` simulates
the exact reset sequence.

```
✓ recreates the bucket and retries once when the first PutObject hits NoSuchBucket
    → Put called twice, CreateBucket called once, upload resolves (no restart)
✓ surfaces the real error when the retry also fails (does not swallow)
✓ does not recreate or retry on the happy path
✓ does NOT self-heal on a non-bucket error (e.g. AccessDenied) — no retry
  Test Files  1 passed (1) · Tests  4 passed (4)
```

The first case is the acceptance-#1 scenario: a `NoSuchBucket` on upload
auto-recovers (bucket recreated + upload retried + succeeds) with **no process
restart**.

## Gates (acceptance #4)

- `@workspace/api` TS: **164** (= baseline, no regression; none in the changed
  files) · `@workspace/shared`: **0**
- eslint `--max-warnings=0` on `lib/s3.ts` + the new test: **clean**
- No test regressions: the upload-path-touching suites pass —
  `raw-file-store/store` (18), `routes/capture-ask`, `mcp/tools/read-file`
  (32 tests across the 3 files), plus the new s3-resilience (4).

## ⚠️ Durability finding (report-only) — MinIO is EPHEMERAL → **S3-DURABLE-1**

Checked via the Railway CLI (`railway volume list`, project
`adventurous-inspiration` / `production`):

```
Volume: postgres-volume  → attached to Postgres  (/var/lib/postgresql/data)  Ready
Volume: redis-volume     → attached to Redis     (/data)                     Ready
(no volume attached to MinIO — or ClickHouse)
```

**MinIO has no persistent Railway volume.** Its object data lives on the
container's ephemeral filesystem, so **every MinIO restart/redeploy wipes all
stored raw files** — which is exactly why the `follow` bucket vanished and why
this seam keeps breaking.

**What this sprint does and does NOT fix:**

- ✅ Self-heal recreates the **bucket** so uploads resume automatically (no
  restart). New raw files written after a reset are stored and indexed normally.
- ❌ It does **not** restore the **original content** of raw files uploaded
  before the reset — that data is gone with the ephemeral volume. **Search still
  works** (embeddings + `index_records` + extracted text live in Postgres, which
  _does_ have a persistent volume), but the **original-file / provenance layer**
  (download the exact bytes the agent ingested) is lost on each MinIO reset.

**The real fix is infra, out of scope here — filed as S3-DURABLE-1:** attach a
persistent Railway volume to MinIO (mount `/data`), or migrate object storage to
a managed store (Cloudflare R2 / AWS S3). Until then, self-heal keeps ingestion
_alive_ but cannot make pre-reset content _durable_.

## Artifacts

- Fixed: `packages/api/src/lib/s3.ts`
- Test: `packages/api/src/lib/__tests__/s3-resilience.test.ts`
- Snapshots: `_archive/2026-06-21-s3-resilience-1/{s3,store}.ts`
- Follow-up: **S3-DURABLE-1** (persistent MinIO volume or managed object store)
