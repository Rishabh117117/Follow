/**
 * Seed Reset — truncate all tables and re-seed.
 *
 * Usage: pnpm seed:reset
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(__dir, '.env.local') })
config({ path: resolve(__dir, '.env') })
config({ path: resolve(__dir, '..', '..', '.env.docker') })

import { db } from '../db/index'
import { waitForDb } from '../db/index'
import { sql } from 'drizzle-orm'
import { runSeed } from './seed'

// Tables in child-first FK order for safe truncation
const TABLES = [
  'thread_events',
  'reference_events',
  'thread_sessions',
  'strand_thread_refs',
  'strand_collaborators',
  'notebook_blocks',
  'notebook_pages',
  'notebooks',
  'document_shared_state',
  'ai_state',
  'document_trackers',
  'external_documents',
  'threads',
  'strands',
  'doc_suggestion_actions',
  'doc_suggestions',
  'document_interpretations',
  'document_patterns',
  'document_decision_trails',
  // KNOWLEDGE-EDGES-DROP-1 (2026-04-22): 'knowledge_edges' table dropped.
  'semantic_links',
  'evidence_records',
  'index_records',
  'episodes',
  'section_aliases',
  'deep_dive_bookmarks',
  'chat_messages',
  'chat_conversations',
  'timeline_annotations',
  'timeline_summaries',
  'recording_sessions',
  'timeline_events',
  'browser_nav_sessions',
  'web_captures',
  'comments',
  'file_shares',
  'notifications',
  'webhooks',
  'api_keys',
  'knowledge_docs',
  'document_chunks',
  'space_documents',
  'spaces',
  'file_versions',
  'files',
  'user_profiles',
  'workspace_members',
  'workspaces',
  'accounts',
  'verification_tokens',
  'users',
]

async function main() {
  await waitForDb()

  console.info('[seed-reset] Truncating all tables...\n')

  for (const table of TABLES) {
    try {
      await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`))
    } catch {
      // Table may not exist yet (e.g., in a fresh DB before drizzle push)
    }
  }

  console.info(`[seed-reset] Truncated ${TABLES.length} tables\n`)

  await runSeed()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-reset] Failed:', err)
    process.exit(1)
  })
