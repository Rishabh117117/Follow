/**
 * S3-RESILIENCE-1 — uploadBuffer self-heals when the bucket has vanished.
 *
 * `ensureBucket()` memoises success, so when MinIO resets and drops the bucket,
 * a cached "ready" means every PutObject fails NoSuchBucket forever and the only
 * recovery used to be an API restart. The upload path must instead detect the
 * missing bucket, reset the memo, recreate the bucket, and retry once.
 *
 * The AWS SDK is mocked: a shared `sendMock` is programmed per command type so
 * we can simulate "HeadBucket says present → PutObject says NoSuchBucket →
 * (after reset) HeadBucket says gone → CreateBucket → PutObject succeeds".
 * The module is re-imported per test so the module-level `bucketReady` memo
 * starts clean and tests are order-independent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Command-type counters the mock switches on (reset each test).
let headCount = 0
let putCount = 0
let createCount = 0
const sendMock = vi.fn()

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/url'),
}))

vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    constructor(public input: unknown) {}
  }
  return {
    S3Client: class {
      send = sendMock
    },
    PutObjectCommand: class extends Cmd {
      _t = 'Put'
    },
    GetObjectCommand: class extends Cmd {
      _t = 'Get'
    },
    DeleteObjectCommand: class extends Cmd {
      _t = 'Delete'
    },
    HeadBucketCommand: class extends Cmd {
      _t = 'Head'
    },
    CreateBucketCommand: class extends Cmd {
      _t = 'Create'
    },
  }
})

function noSuchBucket(): Error {
  const e = new Error('The specified bucket does not exist') as Error & {
    name: string
    $metadata: { httpStatusCode: number }
  }
  e.name = 'NoSuchBucket'
  e.$metadata = { httpStatusCode: 404 }
  return e
}

async function importUploadBuffer() {
  vi.resetModules()
  const mod = await import('../s3')
  return mod.uploadBuffer
}

beforeEach(() => {
  headCount = 0
  putCount = 0
  createCount = 0
  sendMock.mockReset()
})

describe('S3-RESILIENCE-1 · uploadBuffer self-heal', () => {
  it('recreates the bucket and retries once when the first PutObject hits NoSuchBucket', async () => {
    sendMock.mockImplementation((cmd: { _t: string }) => {
      switch (cmd._t) {
        case 'Head':
          headCount++
          // First check (initial ensureBucket): bucket appears present.
          // Second check (after self-heal reset): bucket is gone.
          return headCount === 1 ? Promise.resolve({}) : Promise.reject(noSuchBucket())
        case 'Create':
          createCount++
          return Promise.resolve({})
        case 'Put':
          putCount++
          // First upload fails because the bucket vanished post-memo; the
          // retry (after recreate) succeeds.
          return putCount === 1 ? Promise.reject(noSuchBucket()) : Promise.resolve({})
        default:
          return Promise.resolve({})
      }
    })

    const uploadBuffer = await importUploadBuffer()
    await expect(
      uploadBuffer('raw-files/u1/abc', Buffer.from('hello'), 'text/plain')
    ).resolves.toBeUndefined()

    expect(putCount).toBe(2) // failed once, retried once
    expect(createCount).toBe(1) // bucket was recreated during self-heal
  })

  it('surfaces the real error when the retry also fails (does not swallow)', async () => {
    sendMock.mockImplementation((cmd: { _t: string }) => {
      switch (cmd._t) {
        case 'Head':
          return Promise.resolve({})
        case 'Create':
          return Promise.resolve({})
        case 'Put':
          putCount++
          return Promise.reject(noSuchBucket()) // both attempts fail
        default:
          return Promise.resolve({})
      }
    })

    const uploadBuffer = await importUploadBuffer()
    await expect(
      uploadBuffer('raw-files/u1/abc', Buffer.from('hello'), 'text/plain')
    ).rejects.toMatchObject({ name: 'NoSuchBucket' })

    expect(putCount).toBe(2) // tried, self-healed, tried again, then gave up
  })

  it('does not recreate or retry on the happy path', async () => {
    sendMock.mockImplementation((cmd: { _t: string }) => {
      if (cmd._t === 'Head') {
        headCount++
        return Promise.resolve({})
      }
      if (cmd._t === 'Put') {
        putCount++
        return Promise.resolve({})
      }
      if (cmd._t === 'Create') {
        createCount++
        return Promise.resolve({})
      }
      return Promise.resolve({})
    })

    const uploadBuffer = await importUploadBuffer()
    await expect(
      uploadBuffer('raw-files/u1/abc', Buffer.from('hello'), 'text/plain')
    ).resolves.toBeUndefined()

    expect(putCount).toBe(1)
    expect(createCount).toBe(0)
  })

  it('does NOT self-heal on a non-bucket error (e.g. auth) — surfaces immediately, no retry', async () => {
    sendMock.mockImplementation((cmd: { _t: string }) => {
      if (cmd._t === 'Head') return Promise.resolve({})
      if (cmd._t === 'Put') {
        putCount++
        const e = new Error('Access Denied') as Error & { name: string }
        e.name = 'AccessDenied'
        return Promise.reject(e)
      }
      if (cmd._t === 'Create') {
        createCount++
        return Promise.resolve({})
      }
      return Promise.resolve({})
    })

    const uploadBuffer = await importUploadBuffer()
    await expect(
      uploadBuffer('raw-files/u1/abc', Buffer.from('hello'), 'text/plain')
    ).rejects.toMatchObject({ name: 'AccessDenied' })

    expect(putCount).toBe(1) // no retry on a non-bucket-missing error
    expect(createCount).toBe(0)
  })
})
