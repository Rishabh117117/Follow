// ─── Signal Types (ClickHouse raw signals) ─────────────────────────────────

export type SignalType =
  | 'tab_switch'
  | 'page_navigate'
  | 'web_navigate'
  | 'visibility'
  | 'scroll'
  | 'selection'
  | 'idle_state'
  | 'ai_turn_external' // opt-in, external AI domains
  | 'ai_turn_native' // Follow's own chat
  | 'doc_edit'
  | 'doc_structural_change'
  | 'heartbeat'
  | 'doc_suggestion_accepted'
  | 'doc_suggestion_rejected'
  | 'ghost_draft_commit'
  | 'ghost_draft_dismiss'
  | 'revision_accept'
  | 'revision_reject'
  // ─── Google Workspace Signal Types (G3) ──────────────────────────────────
  // Google Docs
  | 'gws_doc_open'
  | 'gws_doc_close'
  | 'gws_doc_edit'
  | 'gws_doc_selection'
  | 'gws_doc_cursor_move'
  | 'gws_doc_formatting'
  | 'gws_doc_structural'
  | 'gws_doc_comment'
  | 'gws_doc_suggestion'
  // Google Sheets
  | 'gws_cell_edit'
  | 'gws_cell_select'
  | 'gws_formula_change'
  | 'gws_sheet_switch'
  // Google Slides
  | 'gws_slide_edit'
  | 'gws_slide_switch'
  | 'gws_slide_add_delete'
  | 'gws_speaker_notes_edit'
  // Shared across GWS
  | 'gws_collaborator_join'
  | 'gws_collaborator_leave'
  | 'gws_title_change'
  // ─── Notebook Signal Types (N1) ──────────────────────────────────────────
  | 'notebook_block_add'
  | 'notebook_block_edit'
  | 'notebook_block_delete'
  | 'notebook_block_move'
  | 'notebook_page_add'
  | 'notebook_page_switch'
  | 'notebook_draw_stroke'

/**
 * GWS signal payload — metadata fields specific to Google Workspace signals.
 * Extends the base CaptureSignal.metadata with document-specific fields.
 */
export interface GWSSignalPayload {
  googleDocId: string
  docType: 'docs' | 'sheets' | 'slides'
  followDocId: string
  // Docs-specific
  revisionId?: string
  changeDescription?: string
  changedParagraphs?: number[]
  wordDelta?: number
  // Sheets-specific
  cellRef?: string
  sheetName?: string
  previousValue?: string
  newValue?: string
  // Slides-specific
  slideIndex?: number
  elementType?: string
  // Shared
  selectedText?: string
  cursorParagraph?: number
  collaboratorName?: string
  collaboratorCount?: number
}

export type CaptureSignal = {
  type: SignalType
  sessionId: string
  threadId?: string // set if signal belongs to a specific tracked thread
  workspaceId: string
  userId: string
  timestamp: string // ISO 8601
  url?: string
  domain?: string
  title?: string
  metadata: Record<string, unknown> // type-specific fields
}

// ─── Thread ─────────────────────────────────────────────────────────────────

export type ThreadType = 'user' | 'ai' | 'doc' | 'browser' | 'import'
export type ThreadStatus = 'active' | 'paused' | 'archived'

export type Thread = {
  id: string
  workspaceId: string
  ownerId: string
  type: ThreadType
  name: string
  status: ThreadStatus
  homeStrandId?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ─── Strand ─────────────────────────────────────────────────────────────────

export type StrandStatus = 'active' | 'paused' | 'archived'

export type Strand = {
  id: string
  workspaceId: string
  ownerId: string
  name: string
  color: string
  status: StrandStatus
  summaryText?: string
  foundingContext?: string
  isPublic: boolean
  strandInstructions?: string
  lastActivityAt: string
  threads?: Thread[] // populated on GET
  collaborators?: StrandCollaborator[]
  keyChanges?: ThreadEvent[] // populated on GET (key_change=true events)
  createdAt: string
  updatedAt: string
}

// ─── Strand → Thread References ─────────────────────────────────────────────

export type StrandThreadRef = {
  id: string
  strandId: string
  threadId: string
  addedAt: string
  addedBy: string
  visibleToCollaborators: boolean
}

// ─── Strand Collaborators ───────────────────────────────────────────────────

export type StrandCollaborator = {
  id: string
  strandId: string
  userId: string
  canSeeUserThread: boolean
  canSeeAiThread: boolean
  canSeeDocThreads: boolean
  canSeeBrowserThread: boolean
  invitedBy: string
  invitedAt: string
}

// ─── Thread Sessions ────────────────────────────────────────────────────────

export type ThreadSessionStatus = 'active' | 'distilling' | 'complete' | 'failed'

export type ThreadSession = {
  id: string
  threadId: string
  recordingSessionId?: string
  startedAt: string
  endedAt?: string
  status: ThreadSessionStatus
  rawSignalCount: number
  distilledEventCount: number
  lastProcessedAt?: string
}

// ─── Thread Events (permanent distilled record) ─────────────────────────────

export type ThreadEventType =
  | 'edit'
  | 'navigation'
  | 'ai_interaction'
  | 'structural_change'
  | 'reference'
  | 'gap'
  | 'import'
  | 'session_start'
  | 'session_end'

export type ThreadEventMagnitude = 'low' | 'medium' | 'high'

export type ThreadEvent = {
  id: string
  threadId: string
  sessionId?: string
  time: string
  label: string
  type: ThreadEventType
  magnitude: ThreadEventMagnitude
  distilledFrom: string[]
  contextNotes?: string
  keyChange: boolean
  migratedFromTimeline?: boolean
  metadata: Record<string, unknown>
  createdAt: string
}

// ─── Reference Events ───────────────────────────────────────────────────────

export type ReferenceByType = 'chat' | 'strand' | 'thread'

export type ReferenceEvent = {
  id: string
  threadId: string
  referencedByType: ReferenceByType
  referencedById: string
  context?: string
  time: string
}

// ─── Cross-Reference Types ──────────────────────────────────────────────────

export type CrossRefType =
  | 'led_to'
  | 'influenced_by'
  | 'applied_to'
  | 'related_to'
  | 'triggered_by'

// ─── Distillation Output (what Gemini returns for each 15s window) ──────────

export type DistillationOutput = {
  events: Array<{
    label: string
    type: ThreadEventType
    magnitude: ThreadEventMagnitude
    keyChange: boolean
    contextNotes: string
    distilledFrom: string[]
    metadata: Record<string, unknown>
  }>
  gapDetected: boolean
  sessionNotes?: string
}
