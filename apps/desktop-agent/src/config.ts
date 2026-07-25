/**
 * Configuration Loader (Sprint DA-1)
 *
 * Loads and validates follow-agent.config.json.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export interface WatchFolder {
  path: string
  preset: 'open' | 'balanced' | 'private'
  recursive: boolean
  includePatterns?: string[]
  excludePatterns?: string[]
  /**
   * STABILIZE-2: if true, uploads bytes to S3 via /api/raw-files/upload.
   * If false (default), sends bytes to /api/raw-files/index-local where
   * the server extracts text + indexes but skips S3 storage. The original
   * file stays on disk, accessible only from the machine that owns it.
   */
  cloudCopy?: boolean
  /**
   * STABILIZE-3: bind files from this folder to a specific project index.
   * When set, uploads carry x-space-id so the API tags raw_files.space_id
   * and scoped queries can filter by index.
   */
  indexId?: string
}

export interface AgentConfig {
  apiUrl: string
  apiKey: string
  workspaceId: string
  folders: WatchFolder[]
  syncIntervalMs: number
  maxFileSizeMb: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export const DEFAULT_EXCLUDES = [
  'node_modules/**',
  '.git/**',
  '.next/**',
  'dist/**',
  'build/**',
  '.cache/**',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  '.env',
  '.env.*',
  '**/*.map',
  '**/thumbs.db',
  '**/.DS_Store',
]

const CONFIG_FILE_NAME = 'follow-agent.config.json'

export function loadConfig(cwd?: string): AgentConfig {
  const dir = cwd ?? process.cwd()
  const configPath = resolve(dir, CONFIG_FILE_NAME)

  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`)
    console.error(`Create a ${CONFIG_FILE_NAME} file with your Follow API key and workspace ID.`)
    process.exit(1)
  }

  let raw: unknown
  try {
    const text = readFileSync(configPath, 'utf-8')
    raw = JSON.parse(text)
  } catch (err) {
    console.error(`Failed to parse config file: ${(err as Error).message}`)
    process.exit(1)
  }

  const config = raw as Record<string, unknown>

  // Validate required fields
  if (!config.apiUrl || typeof config.apiUrl !== 'string') {
    console.error('Config error: apiUrl is required (e.g., "http://localhost:3001")')
    process.exit(1)
  }
  if (!config.apiKey || typeof config.apiKey !== 'string') {
    console.error('Config error: apiKey is required. Generate one at /api/mcp/keys')
    process.exit(1)
  }
  if (!config.workspaceId || typeof config.workspaceId !== 'string') {
    console.error('Config error: workspaceId is required')
    process.exit(1)
  }
  if (!Array.isArray(config.folders) || config.folders.length === 0) {
    console.error('Config error: folders array is required with at least one entry')
    process.exit(1)
  }

  return {
    apiUrl: config.apiUrl as string,
    apiKey: config.apiKey as string,
    workspaceId: config.workspaceId as string,
    folders: (config.folders as WatchFolder[]).map((f) => ({
      path: f.path,
      preset: f.preset ?? 'open',
      recursive: f.recursive ?? true,
      includePatterns: f.includePatterns,
      excludePatterns: f.excludePatterns,
      // STABILIZE-2/3: preserve cloudCopy + indexId so the syncer can branch
      // on them. The previous version silently dropped both fields, which is
      // why uploads never tagged with space_id even though the JSON on disk
      // had indexId set.
      cloudCopy: f.cloudCopy,
      indexId: f.indexId,
    })),
    syncIntervalMs: (config.syncIntervalMs as number) ?? 5000,
    maxFileSizeMb: (config.maxFileSizeMb as number) ?? 50,
    logLevel: (config.logLevel as AgentConfig['logLevel']) ?? 'info',
  }
}
