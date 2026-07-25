/**
 * Typed environment configuration with fail-fast validation.
 * Loaded once at startup; services import `env` for config access.
 */

interface EnvConfig {
  // Database
  DATABASE_URL: string | undefined
  CLICKHOUSE_URL: string | undefined
  REDIS_URL: string | undefined

  // S3
  S3_ACCESS_KEY_ID: string | undefined
  S3_SECRET_ACCESS_KEY: string | undefined
  S3_REGION: string
  S3_BUCKET: string
  S3_ENDPOINT: string | undefined

  // AI
  OPENROUTER_API_KEY: string | undefined

  // Auth
  NEXTAUTH_SECRET: string | undefined
  // AUTH-FIX-1: dedicated secret for the web-minted / API-verified bearer JWT
  // (human identity). Must match the same var in the web service.
  AUTH_API_SECRET: string | undefined

  // Flags
  isDev: boolean
  useDockerInfra: boolean
}

function loadEnv(): EnvConfig {
  return {
    DATABASE_URL: process.env['DATABASE_URL'],
    CLICKHOUSE_URL: process.env['CLICKHOUSE_URL'],
    REDIS_URL: process.env['REDIS_URL'],
    S3_ACCESS_KEY_ID: process.env['S3_ACCESS_KEY_ID'],
    S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'],
    S3_REGION: process.env['S3_REGION'] || 'us-east-1',
    S3_BUCKET: process.env['S3_BUCKET'] || 'workspace-platform-files',
    S3_ENDPOINT: process.env['S3_ENDPOINT'],
    OPENROUTER_API_KEY: process.env['OPENROUTER_API_KEY'],
    NEXTAUTH_SECRET: process.env['NEXTAUTH_SECRET'],
    AUTH_API_SECRET: process.env['AUTH_API_SECRET'],
    isDev: process.env['NODE_ENV'] !== 'production',
    useDockerInfra:
      !!process.env['DATABASE_URL'] &&
      !!process.env['CLICKHOUSE_URL'] &&
      !!process.env['REDIS_URL'],
  }
}

export function validateEnv(): void {
  const e = loadEnv()
  const warnings: string[] = []
  const infra: string[] = []

  if (!e.DATABASE_URL) warnings.push('DATABASE_URL not set — using PGlite fallback')
  else infra.push('PostgreSQL')

  if (!e.CLICKHOUSE_URL) warnings.push('CLICKHOUSE_URL not set — using in-memory fallback')
  else infra.push('ClickHouse')

  if (!e.REDIS_URL) warnings.push('REDIS_URL not set — using in-memory fallback')
  else infra.push('Redis')

  if (!e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY)
    warnings.push('S3 credentials not set — file uploads will fail')
  else infra.push(e.S3_ENDPOINT ? 'MinIO (S3)' : 'S3')

  if (!e.OPENROUTER_API_KEY) warnings.push('OPENROUTER_API_KEY not set — AI features will fail')

  if (!e.AUTH_API_SECRET)
    warnings.push(
      'AUTH_API_SECRET not set — web bearer-token auth disabled; identity falls back to the x-user-id header (AUTH-FIX-1 dual-accept)'
    )

  if (infra.length > 0) {
    console.info(`\u2705 Infrastructure: ${infra.join(', ')}`)
  }
  if (warnings.length > 0) {
    warnings.forEach((w) => console.warn(`\u26a0\ufe0f  ${w}`))
  }
}

export const env = loadEnv()
