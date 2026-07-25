import Redis from 'ioredis'

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379'

/**
 * In-memory Redis-compatible store for development when Redis is not available.
 * Supports the subset of Redis commands used throughout the codebase.
 */
class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>()

  private isExpired(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry) return true
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return true
    }
    return false
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) return null
    return this.store.get(key)?.value ?? null
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: null })
    return 'OK'
  }

  async setex(key: string, ttl: number, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0
    for (const key of keys) {
      if (this.store.delete(key)) count++
    }
    return count
  }

  async exists(key: string): Promise<number> {
    return this.isExpired(key) ? 0 : 1
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    )
    const result: string[] = []
    for (const key of this.store.keys()) {
      if (!this.isExpired(key) && regex.test(key)) {
        result.push(key)
      }
    }
    return result
  }

  async ttl(key: string): Promise<number> {
    if (this.isExpired(key)) return -2
    const entry = this.store.get(key)
    if (!entry?.expiresAt) return -1
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000))
  }

  pipeline() {
    const ops: Array<{ method: string; args: unknown[] }> = []
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    const chain = {
      get(key: string) {
        ops.push({ method: 'get', args: [key] })
        return chain
      },
      set(key: string, value: string) {
        ops.push({ method: 'set', args: [key, value] })
        return chain
      },
      setex(key: string, ttl: number, value: string) {
        ops.push({ method: 'setex', args: [key, ttl, value] })
        return chain
      },
      del(...keys: string[]) {
        ops.push({ method: 'del', args: keys })
        return chain
      },
      async exec(): Promise<[null, unknown][]> {
        const results: [null, unknown][] = []
        for (const op of ops) {
          const fn = (self as Record<string, (...a: unknown[]) => Promise<unknown>>)[op.method]
          if (fn) {
            const result = await fn.call(self, ...op.args)
            results.push([null, result])
          }
        }
        return results
      },
    }
    return chain
  }

  on(_event: string, _fn: (...args: unknown[]) => void) {
    return this
  }
  connect() {
    return Promise.resolve()
  }
  disconnect() {
    return Promise.resolve()
  }
}

// Create the Redis client — try real Redis first, fall back to in-memory on error
let _redis: Redis | InMemoryRedis
let _fallbackActivated = false

const client = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 3) {
      // After 3 attempts, switch to in-memory if not already done
      if (!_fallbackActivated) {
        _fallbackActivated = true
        console.warn('[Redis] Not available — switching to in-memory fallback')
        _redis = new InMemoryRedis() as unknown as Redis
      }
      return null // Stop retrying
    }
    return Math.min(times * 100, 1000)
  },
  reconnectOnError(err: Error) {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED']
    return targetErrors.some((target) => err.message.includes(target))
  },
  lazyConnect: true,
  enableOfflineQueue: false,
})

client.on('connect', () => {
  console.info('[Redis] Connected')
})

client.on('error', () => {
  // Errors are handled by retryStrategy
})

client.on('close', () => {
  if (!_fallbackActivated) {
    console.warn('[Redis] Connection closed')
  }
})

// Start with real client
_redis = client as Redis

// Try to connect — failures handled by retryStrategy which activates fallback
client.connect().catch(() => {
  if (!_fallbackActivated) {
    _fallbackActivated = true
    console.warn('[Redis] Not available — using in-memory fallback')
    _redis = new InMemoryRedis() as unknown as Redis
  }
})

// Export a proxy that always reads from the current _redis reference
// This ensures that even if _redis switches from real Redis to InMemoryRedis after
// module load, all callers see the updated reference.
export const redis = new Proxy({} as Redis, {
  get(_target, prop, _receiver) {
    return Reflect.get(_redis, prop, _redis)
  },
})

/**
 * Helper to get a cached value or compute and cache it.
 */
export async function cachedGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = 300
): Promise<T> {
  try {
    const cached = await redis.get(key)
    if (cached) {
      return JSON.parse(cached) as T
    }
  } catch {
    // Redis unavailable — just compute
  }

  const value = await fetcher()
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value))
  } catch {
    // Redis unavailable — skip cache
  }
  return value
}

/**
 * Helper to invalidate a cache key.
 */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(key)
  } catch {
    // Redis unavailable
  }
}

/**
 * Helper to invalidate all cache keys matching a pattern.
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } catch {
    // Redis unavailable
  }
}
