/**
 * Comprehensive seed script for Follow dev environment.
 *
 * Creates: 2 users, 1 workspace, 5 documents with TipTap content,
 * 1 notebook (3 pages), 1 strand with 3 threads, 100 thread_events,
 * AI state, document shared state, 1 external document.
 *
 * Usage: pnpm seed
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
import { seedDevUser } from '../db/seed-dev-user'
import { users, userProfiles } from '../db/schema/users'
import { workspaceMembers } from '../db/schema/workspaces'
import { files } from '../db/schema/files'
import { notebooks, notebookPages, notebookBlocks } from '../db/schema/notebooks'
import {
  strands,
  threads,
  strandThreadRefs,
  strandCollaborators,
  threadSessions,
  threadEvents,
} from '../db/schema/threads'
import { aiState, documentSharedState } from '../db/schema/ai-state'
import { externalDocuments } from '../db/schema/external-documents'
import { and, eq } from 'drizzle-orm'
import { SEED } from './seed-constants'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'
import type { NotebookBlockData } from '@workspace/shared/types'

// ─── Collaborator ──────────────────────────────────────────────────────────

const COLLABORATOR = {
  id: SEED.COLLABORATOR_ID,
  email: 'sam@follow.app',
  name: 'Sam Chen',
}

// ─── TipTap Content Helpers ────────────────────────────────────────────────

function heading(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function boldParagraph(boldText: string, normalText: string) {
  return {
    type: 'paragraph',
    content: [
      { type: 'text', marks: [{ type: 'bold' }], text: boldText },
      { type: 'text', text: normalText },
    ],
  }
}

function tiptapDoc(...nodes: Record<string, unknown>[]) {
  return { type: 'doc', content: nodes }
}

// ─── Document Content ──────────────────────────────────────────────────────

const THESIS_CONTENT = tiptapDoc(
  heading(1, 'Cognitive Load in AI-Assisted Document Creation'),
  heading(2, 'Abstract'),
  paragraph(
    'This thesis examines how AI writing tools affect cognitive load during document creation. Drawing on Cognitive Load Theory (Sweller, 1988) and the Extended Mind Thesis (Clark & Chalmers, 1998), we argue that while AI assistance reduces extraneous load, it simultaneously introduces a novel form of cognitive debt through reduced germane processing.'
  ),
  heading(2, '1. Introduction'),
  paragraph(
    'The proliferation of AI-powered writing assistants has fundamentally altered the process of document creation. Tools such as GPT-based autocomplete, AI-driven restructuring, and automated summarization promise to enhance productivity by offloading routine cognitive tasks. However, the implications of this cognitive offloading for deep learning and knowledge construction remain poorly understood.'
  ),
  paragraph(
    'We propose the concept of cognitive debt: a deficit in understanding that accumulates when users accept AI-generated content without fully processing its semantic implications. This concept parallels technical debt in software engineering, where short-term expediency creates long-term maintenance burdens.'
  ),
  heading(2, '2. Literature Review'),
  paragraph(
    'Cognitive Load Theory distinguishes three types of load: intrinsic (inherent complexity), extraneous (unnecessary difficulty), and germane (productive processing). Sweller and colleagues have demonstrated that instructional design should minimize extraneous load while maximizing germane load to promote schema acquisition.'
  ),
  paragraph(
    'Clark and Chalmers (1998) argue that cognitive processes extend beyond the brain to include external tools and artifacts. Under this view, AI writing tools become part of the extended cognitive system. However, the question of whether such extension enhances or diminishes genuine understanding remains contentious.'
  ),
  paragraph(
    'Kalyuga (2019) introduced the expertise-dependent framework, showing that the effects of external support vary with learner expertise. Novices benefit from scaffolding, while experts may experience redundancy effects. This finding is directly relevant to AI writing assistance, where the same tool may help a novice but hinder an expert writer.'
  ),
  heading(2, '3. Methodology'),
  paragraph(
    'We employ a mixed-methods approach combining quantitative analysis of writing behavior with qualitative interviews. Participants (N=48) were assigned to one of three conditions: no AI assistance, selective AI assistance, and full AI assistance. Writing sessions were recorded and analyzed for pausing behavior, revision patterns, and cognitive load indicators.'
  ),
  paragraph(
    'Data collection instruments include NASA-TLX for subjective workload, eye-tracking for attention allocation, and keystroke logging for behavioral analysis. Semi-structured interviews provided qualitative data on participant experiences and metacognitive awareness.'
  ),
  heading(2, '4. Results'),
  paragraph(
    'Preliminary analysis reveals a paradoxical pattern. Participants in the full AI condition produced higher-quality first drafts (as rated by blind evaluators) but demonstrated significantly lower comprehension of their own arguments when tested 48 hours later. This comprehension gap was most pronounced for AI-generated structural elements and citations.'
  ),
  paragraph(
    'The selective AI condition showed the most balanced profile: moderate quality improvement with minimal comprehension loss. These participants reported the highest metacognitive awareness, suggesting that deliberate engagement with AI suggestions promotes deeper processing.'
  ),
  heading(2, '5. Conclusion'),
  paragraph(
    'Our findings support the cognitive debt hypothesis: unreflective use of AI writing tools creates a measurable gap between document quality and author understanding. We recommend a framework of deliberate AI engagement that preserves germane cognitive load while leveraging AI for extraneous load reduction.'
  )
)

const Q3_REPORT_CONTENT = tiptapDoc(
  heading(1, 'Q3 Product Report'),
  heading(2, 'Executive Summary'),
  paragraph(
    'Q3 saw significant progress across all product verticals. The Follow platform launched three major features: the Provenance Panel, the Intelligence Layer, and Google Workspace integration. Monthly active users grew 34% quarter-over-quarter, with retention improving from 62% to 71%.'
  ),
  heading(2, 'Key Metrics'),
  boldParagraph('MAU: ', '12,400 (+34% QoQ)'),
  boldParagraph('Retention (D30): ', '71% (+9pp QoQ)'),
  boldParagraph('NPS: ', '47 (+12 QoQ)'),
  heading(2, 'Product Updates'),
  paragraph(
    'The Provenance Panel provides document-level intelligence including contributor tracking, narrative phase detection, and tension identification. Early adopters report 40% faster context-switching between collaborative documents.'
  ),
  paragraph(
    'The Intelligence Layer (Sprints IX-4 through IX-7) introduced a four-layer AI state system: immediate, event, session, and persistent. This enables the AI to maintain context across sessions and detect long-term patterns in user behavior.'
  ),
  heading(2, 'Outlook'),
  paragraph(
    'Q4 priorities include infrastructure hardening, seed data for testing, and expansion of the GWS extension to Google Sheets and Slides. The team is also exploring real-time collaboration features for the canvas surface.'
  )
)

const WORKSHOP_CONTENT = tiptapDoc(
  heading(1, 'Workshop Script — Intelligence Gap'),
  heading(2, 'Overview'),
  paragraph(
    'This workshop explores the gap between AI-generated content and human understanding. Participants will experience cognitive debt firsthand through a series of writing exercises with varying levels of AI assistance.'
  ),
  heading(2, 'Exercise 1: Baseline Writing'),
  paragraph(
    'Participants write a 500-word argument on a given topic without AI assistance. Time: 20 minutes. This establishes a baseline for writing quality and comprehension.'
  ),
  heading(2, 'Exercise 2: Full AI Assistance'),
  paragraph(
    'Participants use an AI tool to generate a complete argument on a different topic. They are instructed to accept all suggestions and produce a polished document. Time: 10 minutes.'
  ),
  heading(2, 'Exercise 3: Comprehension Test'),
  paragraph(
    'Participants answer questions about both documents without access to the originals. The expected outcome is significantly lower comprehension for the AI-assisted document despite equivalent or higher quality.'
  ),
  heading(2, 'Debrief'),
  paragraph(
    'Facilitate discussion on the experience. Key questions: Did the AI-assisted writing feel easier? Were you surprised by the comprehension results? How might you use AI tools differently going forward?'
  )
)

const PRODUCT_BRIEF_CONTENT = tiptapDoc(
  heading(1, 'Product Brief — Follow'),
  heading(2, 'Vision'),
  paragraph(
    'Follow is an AI-native workspace that makes knowledge work transparent. Unlike traditional productivity tools that treat documents as isolated artifacts, Follow weaves a continuous thread of context across documents, conversations, and browser activity.'
  ),
  heading(2, 'Core Capabilities'),
  paragraph(
    'Provenance tracking: Every edit, AI interaction, and navigation event is captured and distilled into a human-readable timeline. The system detects narrative phases, identifies tensions between sections, and tracks contributor patterns.'
  ),
  paragraph(
    'Intelligence layers: A four-tier AI state system maintains immediate reactions, session context, persistent knowledge, and shared document state. This enables context-aware suggestions that improve over time.'
  ),
  heading(2, 'Target User'),
  paragraph(
    'Knowledge workers who create complex, collaborative documents: researchers, product managers, analysts, and technical writers. Users who need to understand not just what a document says, but how it got there.'
  )
)

const MEETING_NOTES_CONTENT = tiptapDoc(
  heading(1, 'Meeting Notes — Apr 3'),
  heading(2, 'Attendees'),
  paragraph('Rishabh Mishra, Sam Chen'),
  heading(2, 'Agenda'),
  paragraph(
    'Sprint INFRA-1 review, seed data planning, GWS extension status update, Q3 report draft feedback.'
  ),
  heading(2, 'Decisions'),
  boldParagraph(
    'Docker setup: ',
    'Ship INFRA-1 as-is. MinIO added for S3-compatible file storage. All 4 services have health checks.'
  ),
  boldParagraph(
    'Seed data: ',
    'Create comprehensive seed with realistic thread events spanning 5 days. Include AI state and document shared state.'
  ),
  boldParagraph(
    'GWS extension: ',
    'Provenance panel v2 is stable. Will defer Sheets/Slides support to Q4.'
  ),
  heading(2, 'Action Items'),
  paragraph(
    'Rishabh: Complete INFRA-2 seed script. Sam: Review Q3 report draft and add metrics section.'
  )
)

// ─── Thread Event Generation ───────────────────────────────────────────────

const DOC_LABELS = [
  'Edited introduction paragraph',
  'Expanded methodology section',
  'Restructured literature review outline',
  'Added Clark & Chalmers citation',
  'Revised abstract wording',
  'Inserted new data table in results',
  'Reworded conclusion paragraph',
  'Added Kalyuga (2019) reference',
  'Fixed citation formatting',
  'Moved section 2.3 before 2.2',
  'Expanded discussion of cognitive debt',
  'Shortened executive summary',
  'Added figure caption for Figure 3',
  'Deleted redundant paragraph in intro',
  'Merged two methodology subsections',
  'Updated participant count to N=48',
  'Added mixed-methods justification',
  'Reformatted bibliography entries',
  'Inserted block quote from Sweller',
  'Revised thesis statement',
  'Added transition between sections 3 and 4',
  'Expanded expertise-dependent framework discussion',
  'Fixed grammatical error in abstract',
  'Added preliminary results paragraph',
  'Rewrote opening sentence of chapter 3',
  'Added NASA-TLX methodology reference',
  'Strengthened argument in section 4.2',
  'Updated word count in metadata',
  'Reorganized references by topic',
  'Added acknowledgments section',
  'Revised participant demographics table',
  'Updated figure numbering after reorder',
  'Added eye-tracking data description',
  'Removed duplicate citation',
  'Expanded deliberate engagement framework',
  'Fixed heading hierarchy in section 2',
  'Added footnote on cognitive load definition',
  'Revised implications paragraph',
  'Inserted qualitative data excerpt',
  'Updated abstract to reflect final results',
]

const AI_LABELS = [
  'Asked about methodology frameworks',
  'AI suggested rewrite of introduction',
  'Discussed outline structure with AI',
  'AI provided summary of related work',
  'Requested AI critique of argument flow',
  'AI suggested alternative citation format',
  'Asked AI to shorten paragraph',
  'AI generated transition sentence',
  'Discussed cognitive debt framing',
  'AI suggested section reordering',
  'Requested AI summary of Kalyuga 2019',
  'AI proposed new thesis statement variant',
  'Asked AI to check logical consistency',
  'AI identified weak evidence in section 4',
  'Discussed results interpretation with AI',
  'AI suggested figure description',
  'Asked AI to explain CLT distinctions',
  'AI proposed methodology refinement',
  'Requested plain-language summary',
  'AI generated bibliography entry',
  'Asked AI to compare two argument structures',
  'AI suggested expanding discussion',
  'Requested AI review of conclusion',
  'AI identified citation gap',
  'Asked AI about mixed-methods approaches',
  'AI proposed counter-argument for section 3',
  'Discussed participant selection criteria',
  'AI suggested data visualization approach',
  'Requested AI paraphrase of dense paragraph',
  'AI generated abstract draft',
]

const USER_LABELS = [
  'Switched to literature review tab',
  'Highlighted key passage in source',
  'Idle period — coffee break',
  'Opened Kalyuga 2019 PDF',
  'Navigated to results section',
  'Scrolled through methodology',
  'Switched between thesis and notes',
  'Opened Q3 report for reference',
  'Idle period — lunch break',
  'Searched for "cognitive load" in document',
  'Copied text from browser to document',
  'Toggled focus mode on',
  'Switched to workshop script',
  'Reviewed AI suggestions panel',
  'Idle period — meeting',
  'Returned to introduction section',
  'Opened product brief for context',
  'Browsed related papers folder',
  'Collapsed sidebar panels',
  'Toggled provenance panel visibility',
  'Scrolled to bibliography',
  'Expanded all section headings',
  'Idle period — short break',
  'Switched to canvas view',
  'Returned to focus mode',
  'Checked word count',
  'Opened meeting notes',
  'Searched for "expertise-dependent"',
  'Reviewed document history',
  'Closed reference panel',
]

type EventType =
  | 'edit'
  | 'navigation'
  | 'ai_interaction'
  | 'structural_change'
  | 'reference'
  | 'gap'
type Magnitude = 'low' | 'medium' | 'high'

interface ThreadEventRow {
  threadId: string
  sessionId: string
  time: Date
  label: string
  type: EventType
  magnitude: Magnitude
  keyChange: boolean
  contextNotes: string | null
  metadata: Record<string, unknown>
}

function generateThreadEvents(): ThreadEventRow[] {
  const events: ThreadEventRow[] = []
  const now = new Date()
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)

  // Generate events across 5 days
  for (let day = 0; day < 5; day++) {
    const dayStart = new Date(fiveDaysAgo.getTime() + day * 24 * 60 * 60 * 1000)
    const eventsPerDay = day === 4 ? 20 : 20 // ~20 per day

    // Create 2-3 activity clusters per day, afternoon hours (13:00-18:00)
    const clusterCount = 2 + (day % 2)
    const clusterStarts = [13, 15, 17].slice(0, clusterCount)

    let dayEventCount = 0
    for (const clusterHour of clusterStarts) {
      if (dayEventCount >= eventsPerDay) break
      const clusterSize = Math.min(3 + Math.floor(Math.random() * 6), eventsPerDay - dayEventCount)

      for (let i = 0; i < clusterSize; i++) {
        const minutes = clusterHour * 60 + i * (2 + Math.floor(Math.random() * 13))
        const time = new Date(dayStart)
        time.setUTCHours(0, minutes, Math.floor(Math.random() * 60), 0)

        // Distribute across threads: ~40% doc, ~30% AI, ~30% user
        const rand = Math.random()
        let threadId: string, sessionId: string, label: string, type: EventType

        if (rand < 0.4) {
          threadId = SEED.THREAD_DOC_ID
          sessionId = SEED.SESSION_DOC_ID
          label = DOC_LABELS[(day * 20 + dayEventCount) % DOC_LABELS.length]!
          type = Math.random() < 0.7 ? 'edit' : 'structural_change'
        } else if (rand < 0.7) {
          threadId = SEED.THREAD_AI_ID
          sessionId = SEED.SESSION_AI_ID
          label = AI_LABELS[(day * 20 + dayEventCount) % AI_LABELS.length]!
          type = 'ai_interaction'
        } else {
          threadId = SEED.THREAD_USER_ID
          sessionId = SEED.SESSION_USER_ID
          label = USER_LABELS[(day * 20 + dayEventCount) % USER_LABELS.length]!
          type = label.includes('Idle') ? 'gap' : 'navigation'
        }

        // Magnitude: 60% low, 30% medium, 10% high
        const magRand = Math.random()
        const magnitude: Magnitude = magRand < 0.6 ? 'low' : magRand < 0.9 ? 'medium' : 'high'

        // ~15% keyChange
        const keyChange = Math.random() < 0.15

        events.push({
          threadId,
          sessionId,
          time,
          label,
          type,
          magnitude,
          keyChange,
          contextNotes: keyChange ? `Significant change in thesis document` : null,
          metadata: {},
        })

        dayEventCount++
      }
    }
  }

  // Sort by time
  events.sort((a, b) => a.time.getTime() - b.time.getTime())

  // Trim to exactly 100
  return events.slice(0, 100)
}

// ─── Main Seed Function ────────────────────────────────────────────────────

export async function runSeed(): Promise<void> {
  console.info('[seed] Starting seed...\n')

  // 1. Base user + workspace (existing function)
  await seedDevUser()
  console.info('[seed] 1/17 Dev user + workspace seeded')

  // 2. Collaborator user
  await db
    .insert(users)
    .values({
      id: COLLABORATOR.id,
      email: COLLABORATOR.email,
      name: COLLABORATOR.name,
    })
    .onConflictDoNothing()
  console.info('[seed] 2/17 Collaborator user seeded')

  // 3. Collaborator workspace membership
  const existingMembership = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, SEED.WORKSPACE_ID),
        eq(workspaceMembers.userId, COLLABORATOR.id)
      )
    )
    .limit(1)

  if (existingMembership.length === 0) {
    await db.insert(workspaceMembers).values({
      workspaceId: SEED.WORKSPACE_ID,
      userId: COLLABORATOR.id,
      role: 'editor',
    })
  }
  console.info('[seed] 3/17 Collaborator membership seeded')

  // 4. Collaborator profile
  await db
    .insert(userProfiles)
    .values({
      id: SEED.COLLABORATOR_PROFILE_ID,
      workspaceId: SEED.WORKSPACE_ID,
      userId: COLLABORATOR.id,
    })
    .onConflictDoNothing()
  console.info('[seed] 4/17 Collaborator profile seeded')

  // 5. Files (5 documents + 1 notebook file)
  const fileRows = [
    {
      id: SEED.FILE_THESIS_ID,
      workspaceId: SEED.WORKSPACE_ID,
      name: 'Thesis Chapter 3 \u2014 Cognitive Load in AI',
      type: 'file' as const,
      mimeType: 'text/html',
      sizeBytes: 14200,
      metadata: { tiptapContent: THESIS_CONTENT },
      createdBy: DEV_USER.id,
    },
    {
      id: SEED.FILE_Q3_REPORT_ID,
      workspaceId: SEED.WORKSPACE_ID,
      name: 'Q3 Product Report',
      type: 'file' as const,
      mimeType: 'text/html',
      sizeBytes: 6100,
      metadata: { tiptapContent: Q3_REPORT_CONTENT },
      createdBy: DEV_USER.id,
    },
    {
      id: SEED.FILE_WORKSHOP_ID,
      workspaceId: SEED.WORKSPACE_ID,
      name: 'Workshop Script \u2014 Intelligence Gap',
      type: 'file' as const,
      mimeType: 'text/html',
      sizeBytes: 3400,
      metadata: { tiptapContent: WORKSHOP_CONTENT },
      createdBy: DEV_USER.id,
    },
    {
      id: SEED.FILE_PRODUCT_BRIEF_ID,
      workspaceId: SEED.WORKSPACE_ID,
      name: 'Product Brief \u2014 Follow',
      type: 'file' as const,
      mimeType: 'text/html',
      sizeBytes: 2500,
      metadata: { tiptapContent: PRODUCT_BRIEF_CONTENT },
      createdBy: DEV_USER.id,
    },
    {
      id: SEED.FILE_MEETING_NOTES_ID,
      workspaceId: SEED.WORKSPACE_ID,
      name: 'Meeting Notes \u2014 Apr 3',
      type: 'file' as const,
      mimeType: 'text/html',
      sizeBytes: 1800,
      metadata: { tiptapContent: MEETING_NOTES_CONTENT },
      createdBy: DEV_USER.id,
    },
    {
      id: SEED.NOTEBOOK_FILE_ID,
      workspaceId: SEED.WORKSPACE_ID,
      name: 'Architecture Sketches',
      type: 'notebook' as const,
      mimeType: 'application/x-notebook',
      sizeBytes: 0,
      metadata: {},
      createdBy: DEV_USER.id,
    },
  ]

  for (const row of fileRows) {
    await db.insert(files).values(row).onConflictDoNothing()
  }
  console.info('[seed] 5/17 Files seeded (5 documents + 1 notebook)')

  // 6. Notebook
  await db
    .insert(notebooks)
    .values({
      id: SEED.NOTEBOOK_ID,
      fileId: SEED.NOTEBOOK_FILE_ID,
      workspaceId: SEED.WORKSPACE_ID,
      pageSize: 'letter',
      pageCount: 3,
      defaultBackground: 'dotted',
      createdBy: DEV_USER.id,
    })
    .onConflictDoNothing()
  console.info('[seed] 6/17 Notebook seeded')

  // 7. Notebook pages
  const pageRows = [
    {
      id: SEED.NOTEBOOK_PAGE_1_ID,
      notebookId: SEED.NOTEBOOK_ID,
      pageNumber: 1,
      background: 'dotted' as const,
      width: 816,
      height: 1056,
    },
    {
      id: SEED.NOTEBOOK_PAGE_2_ID,
      notebookId: SEED.NOTEBOOK_ID,
      pageNumber: 2,
      background: 'grid' as const,
      width: 816,
      height: 1056,
    },
    {
      id: SEED.NOTEBOOK_PAGE_3_ID,
      notebookId: SEED.NOTEBOOK_ID,
      pageNumber: 3,
      background: 'blank' as const,
      width: 816,
      height: 1056,
    },
  ]
  for (const row of pageRows) {
    await db.insert(notebookPages).values(row).onConflictDoNothing()
  }
  console.info('[seed] 7/17 Notebook pages seeded')

  // 8. Notebook blocks
  const blockRows: Array<{
    pageId: string
    notebookId: string
    type: 'text' | 'sticky' | 'shape'
    x: number
    y: number
    width: number
    height: number
    zIndex: number
    data: NotebookBlockData
    createdBy: string
  }> = [
    // Page 1: system architecture diagram notes
    {
      pageId: SEED.NOTEBOOK_PAGE_1_ID,
      notebookId: SEED.NOTEBOOK_ID,
      type: 'text',
      x: 50,
      y: 50,
      width: 300,
      height: 80,
      zIndex: 1,
      data: {
        type: 'text',
        richTextContent: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'System Architecture Overview — 4-layer AI state, event bus, timeline pipeline',
                },
              ],
            },
          ],
        },
        plainText: 'System Architecture Overview — 4-layer AI state, event bus, timeline pipeline',
      },
      createdBy: DEV_USER.id,
    },
    {
      pageId: SEED.NOTEBOOK_PAGE_1_ID,
      notebookId: SEED.NOTEBOOK_ID,
      type: 'sticky',
      x: 400,
      y: 50,
      width: 200,
      height: 120,
      zIndex: 2,
      data: { type: 'sticky', text: 'TODO: Add Redis caching layer diagram', color: '#FFF3BF' },
      createdBy: DEV_USER.id,
    },
    {
      pageId: SEED.NOTEBOOK_PAGE_1_ID,
      notebookId: SEED.NOTEBOOK_ID,
      type: 'shape',
      x: 50,
      y: 200,
      width: 300,
      height: 200,
      zIndex: 0,
      data: {
        type: 'shape',
        shapeType: 'rectangle',
        fill: '#E8F4FD',
        stroke: '#4A90D9',
        strokeWidth: 2,
        cornerRadius: 8,
      },
      createdBy: DEV_USER.id,
    },
    // Page 2: data flow notes
    {
      pageId: SEED.NOTEBOOK_PAGE_2_ID,
      notebookId: SEED.NOTEBOOK_ID,
      type: 'text',
      x: 50,
      y: 50,
      width: 400,
      height: 100,
      zIndex: 1,
      data: {
        type: 'text',
        richTextContent: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Data Flow: Browser Signal -> ClickHouse -> Timeline Aggregator -> Thread Distillation -> Semantic Index',
                },
              ],
            },
          ],
        },
        plainText:
          'Data Flow: Browser Signal -> ClickHouse -> Timeline Aggregator -> Thread Distillation -> Semantic Index',
      },
      createdBy: DEV_USER.id,
    },
    {
      pageId: SEED.NOTEBOOK_PAGE_2_ID,
      notebookId: SEED.NOTEBOOK_ID,
      type: 'sticky',
      x: 50,
      y: 200,
      width: 200,
      height: 120,
      zIndex: 2,
      data: {
        type: 'sticky',
        text: 'Need to benchmark ClickHouse query performance with 1M+ events',
        color: '#FFE0E0',
      },
      createdBy: DEV_USER.id,
    },
    // Page 3: UI wireframe notes
    {
      pageId: SEED.NOTEBOOK_PAGE_3_ID,
      notebookId: SEED.NOTEBOOK_ID,
      type: 'text',
      x: 50,
      y: 50,
      width: 350,
      height: 60,
      zIndex: 1,
      data: {
        type: 'text',
        richTextContent: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Provenance Panel wireframe — 3 tabs: History, Meaning, Notes',
                },
              ],
            },
          ],
        },
        plainText: 'Provenance Panel wireframe — 3 tabs: History, Meaning, Notes',
      },
      createdBy: DEV_USER.id,
    },
  ]

  for (const row of blockRows) {
    await db.insert(notebookBlocks).values(row).onConflictDoNothing()
  }
  console.info('[seed] 8/17 Notebook blocks seeded')

  // 9. Strand
  await db
    .insert(strands)
    .values({
      id: SEED.STRAND_ID,
      workspaceId: SEED.WORKSPACE_ID,
      ownerId: DEV_USER.id,
      name: 'Thesis Research',
      color: '#5B4FC4',
      status: 'active',
      summaryText:
        'Research and writing for capstone thesis on cognitive debt in AI-assisted document creation.',
      foundingContext: 'Exploring how AI tools create cognitive debt by reducing germane load.',
    })
    .onConflictDoNothing()
  console.info('[seed] 9/17 Strand seeded')

  // 10. Threads
  const threadRows = [
    {
      id: SEED.THREAD_DOC_ID,
      workspaceId: SEED.WORKSPACE_ID,
      ownerId: DEV_USER.id,
      type: 'doc' as const,
      name: 'Thesis — Document Thread',
      homeStrandId: SEED.STRAND_ID,
      metadata: { fileId: SEED.FILE_THESIS_ID },
    },
    {
      id: SEED.THREAD_AI_ID,
      workspaceId: SEED.WORKSPACE_ID,
      ownerId: DEV_USER.id,
      type: 'ai' as const,
      name: 'Thesis — AI Thread',
      homeStrandId: SEED.STRAND_ID,
      metadata: {},
    },
    {
      id: SEED.THREAD_USER_ID,
      workspaceId: SEED.WORKSPACE_ID,
      ownerId: DEV_USER.id,
      type: 'user' as const,
      name: 'Thesis — User Thread',
      homeStrandId: SEED.STRAND_ID,
      metadata: {},
    },
  ]

  for (const row of threadRows) {
    await db.insert(threads).values(row).onConflictDoNothing()
  }
  console.info('[seed] 10/17 Threads seeded')

  // 11. Strand-thread refs
  const strandRefRows = [
    { strandId: SEED.STRAND_ID, threadId: SEED.THREAD_DOC_ID, addedBy: DEV_USER.id },
    { strandId: SEED.STRAND_ID, threadId: SEED.THREAD_AI_ID, addedBy: DEV_USER.id },
    { strandId: SEED.STRAND_ID, threadId: SEED.THREAD_USER_ID, addedBy: DEV_USER.id },
  ]
  for (const row of strandRefRows) {
    await db.insert(strandThreadRefs).values(row).onConflictDoNothing()
  }
  console.info('[seed] 11/17 Strand-thread refs seeded')

  // 12. Strand collaborator
  await db
    .insert(strandCollaborators)
    .values({
      strandId: SEED.STRAND_ID,
      userId: COLLABORATOR.id,
      canSeeUserThread: false,
      canSeeAiThread: false,
      canSeeDocThreads: true,
      canSeeBrowserThread: false,
      invitedBy: DEV_USER.id,
    })
    .onConflictDoNothing()
  console.info('[seed] 12/17 Strand collaborator seeded')

  // 13. Thread sessions
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
  const sessionRows = [
    {
      id: SEED.SESSION_DOC_ID,
      threadId: SEED.THREAD_DOC_ID,
      startedAt: fiveDaysAgo,
      status: 'complete' as const,
      rawSignalCount: 200,
      distilledEventCount: 40,
    },
    {
      id: SEED.SESSION_AI_ID,
      threadId: SEED.THREAD_AI_ID,
      startedAt: fiveDaysAgo,
      status: 'complete' as const,
      rawSignalCount: 150,
      distilledEventCount: 30,
    },
    {
      id: SEED.SESSION_USER_ID,
      threadId: SEED.THREAD_USER_ID,
      startedAt: fiveDaysAgo,
      status: 'complete' as const,
      rawSignalCount: 120,
      distilledEventCount: 30,
    },
  ]
  for (const row of sessionRows) {
    await db.insert(threadSessions).values(row).onConflictDoNothing()
  }
  console.info('[seed] 13/17 Thread sessions seeded')

  // 14. Thread events (100)
  const eventRows = generateThreadEvents()
  for (const row of eventRows) {
    await db.insert(threadEvents).values(row).onConflictDoNothing()
  }
  console.info(`[seed] 14/17 Thread events seeded (${eventRows.length} events)`)

  // 15. AI state
  const recentEvents = eventRows.slice(-10).map((e) => ({
    label: e.label,
    type: e.type,
    magnitude: e.magnitude,
    time: e.time.toISOString(),
    threadId: e.threadId,
  }))

  await db
    .insert(aiState)
    .values({
      userId: DEV_USER.id,
      workspaceId: SEED.WORKSPACE_ID,
      stateEvent: {
        recentEvents,
        activeTensions: [
          {
            id: 't1',
            text: 'Section 2 cites Kalyuga (2019) which partially contradicts the framing in Section 1',
            severity: 'medium',
            section: 'Section 2',
            tentative: false,
          },
          {
            id: 't2',
            text: 'Workshop script methodology differs from thesis methodology description',
            severity: 'low',
            section: 'Methodology',
            tentative: true,
          },
        ],
        activeKnowledge: [
          {
            fact: 'Working on capstone thesis about cognitive debt in AI tools',
            confidence: 0.95,
            source: 'document_edit',
          },
          {
            fact: 'Uses Clark & Chalmers Extended Mind Thesis as theoretical frame',
            confidence: 0.92,
            source: 'document_edit',
          },
          {
            fact: 'Prefers Chicago Notes-Bibliography citation style',
            confidence: 0.88,
            source: 'pattern',
          },
          {
            fact: 'Collaborates with Sam on product documents',
            confidence: 0.85,
            source: 'collaboration',
          },
        ],
      },
      stateSession: {
        sectionsVisited: ['Introduction', 'Methodology', 'Literature Review'],
        documentsWorkedOn: [SEED.FILE_THESIS_ID, SEED.FILE_Q3_REPORT_ID, SEED.FILE_WORKSHOP_ID],
        aiInteractionCount: 12,
        teamUpdates: [],
      },
      statePersistent: {
        workStyle: {
          type: 'research-first',
          description: 'Tends to read and annotate sources before writing',
        },
        productiveHours: { start: 14, end: 18, timezone: 'America/New_York' },
        avgSessionDuration: 47,
        aiPreferences: { acceptanceRate: 0.73, preferredActions: ['rewrite', 'shorten'] },
        collaborationStyle: 'review-then-edit',
        longTermKnowledge: [
          { fact: 'Working on capstone thesis about cognitive debt in AI tools', confidence: 0.95 },
          {
            fact: 'Uses Clark & Chalmers Extended Mind Thesis as theoretical frame',
            confidence: 0.92,
          },
          { fact: 'Prefers Chicago Notes-Bibliography citation style', confidence: 0.88 },
          { fact: 'Collaborates with Sam on product documents', confidence: 0.85 },
        ],
      },
      version: 1,
    })
    .onConflictDoNothing()
  console.info('[seed] 15/17 AI state seeded')

  // 16. Document shared state (thesis)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  await db
    .insert(documentSharedState)
    .values({
      documentId: SEED.FILE_THESIS_ID,
      workspaceId: SEED.WORKSPACE_ID,
      state: {
        contributions: {
          [DEV_USER.id]: {
            editCount: 45,
            sections: ['Introduction', 'Methodology', 'Literature Review', 'Conclusion'],
            role: 'heavy_editor',
            lastEditAt: new Date().toISOString(),
          },
          [COLLABORATOR.id]: {
            editCount: 8,
            sections: ['Literature Review'],
            role: 'light_editor',
            lastEditAt: oneDayAgo.toISOString(),
          },
        },
        sharedKnowledge: [
          {
            fact: 'Thesis argues AI tools create cognitive debt',
            confidence: 0.95,
            addedBy: DEV_USER.id,
            status: 'confirmed',
          },
          {
            fact: 'Kalyuga 2019 shows expertise-dependent effects',
            confidence: 0.88,
            addedBy: COLLABORATOR.id,
            status: 'confirmed',
          },
        ],
        disputedKnowledge: [],
        phase: 'convergence',
        intent: 'Synthesizing theoretical framework with empirical evidence',
        aiUsage: {
          totalInteractions: 24,
          acceptedSuggestions: 17,
          rejectedSuggestions: 7,
          sectionsWithAI: ['Introduction', 'Conclusion'],
        },
      },
      version: 1,
    })
    .onConflictDoNothing()
  console.info('[seed] 16/17 Document shared state seeded')

  // 17. External document (GWS simulation)
  await db
    .insert(externalDocuments)
    .values({
      id: SEED.EXTERNAL_DOC_ID,
      workspaceId: SEED.WORKSPACE_ID,
      userId: DEV_USER.id,
      externalDocId: '1abc2def3ghi4jkl5mno',
      docType: 'google_docs',
      title: 'Workshop Facilitation Guide',
      metadata: {
        lastKnownTitle: 'Workshop Facilitation Guide',
        collaboratorCount: 2,
        signalCount: 15,
        lastSignalAt: new Date().toISOString(),
      },
    })
    .onConflictDoNothing()
  console.info('[seed] 17/17 External document seeded')

  console.info('\n[seed] Seed complete!')
  console.info(`  Users: 2 (${DEV_USER.name}, ${COLLABORATOR.name})`)
  console.info(`  Workspace: ${DEV_WORKSPACE.name}`)
  console.info(`  Files: 6 (5 documents + 1 notebook)`)
  console.info(`  Strand: 1, Threads: 3, Events: ${eventRows.length}`)
  console.info(`  AI state: 1, Shared state: 1, External doc: 1`)
}

// ─── Entry Point ───────────────────────────────────────────────────────────

async function main() {
  await waitForDb()
  await runSeed()
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Failed:', err)
    process.exit(1)
  })
