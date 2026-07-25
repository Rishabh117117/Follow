import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3Endpoint = process.env['S3_ENDPOINT']
const s3 = new S3Client({
  region: process.env['S3_REGION'] ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
  },
  // MinIO support: custom endpoint + path-style addressing
  ...(s3Endpoint ? { endpoint: s3Endpoint, forcePathStyle: true } : {}),
})

const bucket = process.env['S3_BUCKET'] ?? 'workspace-platform-files'

// Dev convenience: auto-create the bucket on first write so a fresh MinIO
// volume doesn't require a manual `mc mb` step. Memoised — after the first
// successful check we skip the HEAD+CREATE round trip. Safe in prod too
// because real AWS rejects CreateBucket for buckets you already own.
let bucketReady: Promise<void> | null = null

/**
 * Reset the ensureBucket() memo so the NEXT call actually re-runs the
 * HeadBucket → CreateBucket logic instead of returning the cached "ready".
 * Used by the upload self-heal path: if the bucket vanished after the memo
 * cached success (e.g. a MinIO reset dropped it), we must be able to detect
 * and recreate it without a process restart. (S3-RESILIENCE-1)
 */
function resetBucketReady(): void {
  bucketReady = null
}

/**
 * True when an S3 error means the bucket itself is gone (vs. a transient or
 * auth error we must NOT paper over). On a PutObject, MinIO/S3 signal a missing
 * bucket as `NoSuchBucket` (HTTP 404); we also treat a bare 404 on the write
 * path as bucket-missing-class.
 */
function isBucketMissing(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  const code = e?.name ?? e?.Code
  if (code === 'NoSuchBucket' || code === 'NoSuchKey') return true
  return e?.$metadata?.httpStatusCode === 404
}

function ensureBucket(): Promise<void> {
  if (bucketReady) return bucketReady
  bucketReady = (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    } catch {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: bucket }))
        console.info(`[s3] provisioned bucket ${bucket}`)
      } catch (err) {
        // If create failed too, reset so next call can retry rather than
        // permanently short-circuiting.
        bucketReady = null
        throw err
      }
    }
  })()
  return bucketReady
}

export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  await ensureBucket()
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn: 3600 })
}

export async function getDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })
  return getSignedUrl(s3, command, { expiresIn: 3600 })
}

export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  })
  await s3.send(command)
}

/**
 * Upload a Buffer directly to S3 (server-side upload, not presigned).
 * Used for capture screenshots and other server-generated content.
 */
export async function uploadBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket()
  const put = () =>
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    )
  try {
    await put()
  } catch (err) {
    if (!isBucketMissing(err)) throw err
    // Self-heal (S3-RESILIENCE-1): the bucket vanished after ensureBucket()
    // memoised "ready" — e.g. a MinIO reset dropped it. Without this, every
    // upload fails NoSuchBucket forever and only an API restart recovers.
    // Reset the memo, recreate the bucket, and retry the upload exactly once.
    // If the retry also fails, surface the real error (do NOT swallow).
    console.warn(`[s3] bucket "${bucket}" missing on upload — recreating and retrying once`)
    resetBucketReady()
    await ensureBucket()
    await put()
  }
}

/**
 * Download a file from S3 as a Buffer (server-side download).
 * Used by raw-file-store and MCP read_file tool.
 */
export async function downloadBuffer(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })
  const response = await s3.send(command)
  const stream = response.Body
  if (!stream) throw new Error(`Empty response for S3 key: ${key}`)
  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function getStorageKey(workspaceId: string, fileId: string, version: number): string {
  return `workspaces/${workspaceId}/files/${fileId}/v${version}`
}

export function getCaptureKey(workspaceId: string, captureId: string): string {
  return `workspaces/${workspaceId}/captures/${captureId}.png`
}
