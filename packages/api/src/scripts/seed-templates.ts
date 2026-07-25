/**
 * Seed Follow document templates for the dev workspace.
 * Idempotent: deletes existing templates first, then re-inserts.
 *
 * Usage: pnpm tsx packages/api/src/scripts/seed-templates.ts
 */

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(__dir, '.env.local') })
config({ path: resolve(__dir, '.env') })
config({ path: resolve(__dir, '..', '..', '.env.docker') })

import { db, waitForDb } from '../db/index'
import { files } from '../db/schema/files'
import { and, eq, sql } from 'drizzle-orm'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

function heading(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}

function paragraph(text: string) {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }
}

function bullet(text: string) {
  return { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text)] }] }
}

function tiptapDoc(...nodes: Record<string, unknown>[]) {
  return { type: 'doc', content: nodes }
}

const TEMPLATES = [
  {
    name: 'Meeting Notes',
    templateType: 'meeting_notes',
    content: tiptapDoc(
      heading(1, 'Meeting Notes'),
      paragraph('Date: '),
      paragraph('Attendees: '),
      heading(2, 'Agenda'),
      bullet('Item 1'),
      heading(2, 'Discussion'),
      paragraph(''),
      heading(2, 'Action Items'),
      bullet('Owner — task — due date'),
      heading(2, 'Decisions'),
      paragraph('')
    ),
  },
  {
    name: 'Project Brief',
    templateType: 'project_brief',
    content: tiptapDoc(
      heading(1, 'Project Brief'),
      heading(2, 'Overview'),
      paragraph('One-paragraph summary of what this project is and why it matters.'),
      heading(2, 'Goals'),
      bullet('Primary goal'),
      bullet('Secondary goal'),
      heading(2, 'Scope'),
      paragraph('In scope:'),
      paragraph('Out of scope:'),
      heading(2, 'Stakeholders'),
      bullet('Owner: '),
      bullet('Contributors: '),
      heading(2, 'Timeline'),
      paragraph('Milestones and target dates.'),
      heading(2, 'Risks'),
      bullet('Risk — mitigation')
    ),
  },
  {
    name: 'Research Summary',
    templateType: 'research_summary',
    content: tiptapDoc(
      heading(1, 'Research Summary'),
      heading(2, 'Question'),
      paragraph('What were we trying to learn?'),
      heading(2, 'Method'),
      paragraph('How did we approach it? Sources, tools, scope.'),
      heading(2, 'Key Findings'),
      bullet('Finding 1'),
      bullet('Finding 2'),
      heading(2, 'Implications'),
      paragraph('What does this mean for the work?'),
      heading(2, 'Open Questions'),
      bullet('Question 1'),
      heading(2, 'References'),
      bullet('Source link')
    ),
  },
] as const

async function main() {
  await waitForDb()

  const workspaceId = DEV_WORKSPACE.id
  const userId = DEV_USER.id

  // Remove existing templates so this is re-runnable
  await db
    .delete(files)
    .where(
      and(
        eq(files.workspaceId, workspaceId),
        sql`(${files.metadata}->>'isTemplate')::boolean = true`
      )
    )

  for (const tpl of TEMPLATES) {
    await db.insert(files).values({
      workspaceId,
      name: tpl.name,
      type: 'file',
      mimeType: 'text/html',
      metadata: {
        editorType: 'document',
        isTemplate: true,
        templateType: tpl.templateType,
        content: tpl.content,
      },
      createdBy: userId,
    })
  }

  console.info(`Seeded ${TEMPLATES.length} templates for workspace ${workspaceId}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('seed-templates failed:', err)
  process.exit(1)
})
