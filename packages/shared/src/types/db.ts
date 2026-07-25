export type Uuid = string

export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type WorkspaceVisibility = 'private' | 'team' | 'public'
export type FileType = 'file' | 'folder' | 'notebook'
export type FileStatus = 'active' | 'archived' | 'deleted'
export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TimelineResolution =
  | '15sec'
  | '5min'
  | '15min'
  | '30min'
  | '1hr'
  | '6hr'
  | '12hr'
  | '1day'
  | '1week'
  | '1month'
export type TriggerType = 'automatic' | 'manual' | 'scheduled'
export type PromptStatus = 'pending' | 'shown' | 'answered' | 'dismissed'
export type QuestionType = 'single_choice' | 'multi_choice' | 'free_text' | 'confirmation'

export interface User {
  id: Uuid
  email: string
  name: string
  avatarUrl: string | null
  createdAt: Date
}

export interface Workspace {
  id: Uuid
  name: string
  slug: string
  ownerId: Uuid
  createdAt: Date
}

export interface WorkspaceMember {
  workspaceId: Uuid
  userId: Uuid
  role: UserRole
  joinedAt: Date
}

export interface Space {
  id: Uuid
  workspaceId: Uuid
  name: string
  description: string | null
  canvasFileId: Uuid | null
  icon: string | null
  color: string | null
  createdBy: Uuid
  createdAt: Date
  updatedAt: Date
}

export interface File {
  id: Uuid
  workspaceId: Uuid
  spaceId: Uuid | null
  parentFolderId: Uuid | null
  name: string
  type: FileType
  mimeType: string | null
  storagePath: string | null
  sizeBytes: number | null
  version: number
  metadata: Record<string, unknown>
  createdBy: Uuid
  createdAt: Date
  updatedAt: Date
}

export interface FileVersion {
  id: Uuid
  fileId: Uuid
  versionNumber: number
  storagePath: string
  sizeBytes: number
  createdBy: Uuid
  createdAt: Date
  diffSummary: string | null
}

export interface TimelineEvent {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid
  timestamp: Date
  actionType: string
  objectType: string
  objectId: Uuid
  payload: Record<string, unknown>
  sessionId: string | null
  agentRunId: Uuid | null
}

export interface TimelineSummary {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid | null
  resolution: TimelineResolution
  periodStart: Date
  periodEnd: Date
  summaryText: string
  topics: string[]
  intent: string | null
  keyObjects: Uuid[]
  metrics: Record<string, unknown>
  embedding: number[] | null
}

export interface AgentRun {
  id: Uuid
  workspaceId: Uuid
  triggeredBy: Uuid
  parentAgentRunId: Uuid | null
  model: string
  systemPrompt: string
  contextSnapshot: Record<string, unknown>
  toolGrants: string[]
  executionConfig: Record<string, unknown>
  status: AgentStatus
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  latencyMs: number | null
  result: Record<string, unknown> | null
  resultRoutedTo: Record<string, unknown> | null
  qualityScore: number | null
  templateId: Uuid | null
  createdAt: Date
}

export interface AgentTemplate {
  id: Uuid
  workspaceId: Uuid
  name: string
  description: string | null
  defaultModel: string
  systemPromptTemplate: string
  defaultToolGrants: string[]
  defaultExecutionConfig: Record<string, unknown>
  avgQualityScore: number | null
  totalRuns: number
  createdBy: Uuid
  isShared: boolean
  createdAt: Date
}

export interface AgentPrompt {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid
  triggerType: TriggerType
  triggerData: Record<string, unknown>
  questionType: QuestionType
  questionText: string
  options: Record<string, unknown>[]
  explanation: string | null
  confidence: number | null
  status: PromptStatus
  userResponse: Record<string, unknown> | null
  resultingAction: Record<string, unknown> | null
  shownAt: Date | null
  respondedAt: Date | null
  batchId: Uuid | null
}

export interface UserProfile {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid
  expertiseAreas: Record<string, unknown>
  promptPreferences: Record<string, unknown>
  interactionStyle: Record<string, unknown>
  knownFacts: Record<string, unknown>[]
  totalPromptsShown: number
  totalPromptsAnswered: number
  totalPromptsDismissed: number
  lastUpdated: Date
}

// ─── Chat ──────────────────────────────────────────────────────────

export type ConversationType = 'standard' | 'deep_dive' | 'agent_initiated' | 'capture_ask' | 'group'
export type ConversationStatus = 'active' | 'archived'
export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatConversation {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid
  spaceId: Uuid | null
  title: string
  type: ConversationType
  parentConversationId: Uuid | null
  contextObjectId: Uuid | null
  contextObjectType: string | null
  status: ConversationStatus
  metadata?: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface ChatMessage {
  id: Uuid
  conversationId: Uuid
  userId: Uuid | null
  role: MessageRole
  content: string
  richContent: RichContent[] | null
  attachments: MessageAttachment[]
  metadata: MessageMetadata
  parentMessageId: Uuid | null
  createdAt: Date
}

export interface RichContent {
  type:
    | 'chart'
    | 'table'
    | 'image'
    | 'canvas_embed'
    | 'file_card'
    | 'comparison'
    | 'timeline_visual'
    | 'code_sandbox'
    | 'callout'
  data: Record<string, unknown>
}

export interface MessageAttachment {
  fileId?: string
  fileName?: string
  fileType?: string
  thumbnailUrl?: string
  /** Base64 data URL for inline images (screenshot & ask, web capture, extension) */
  imageData?: string
  /** Provenance of the image */
  imageSource?: 'screenshot' | 'upload' | 'capture' | 'canvas'
  /** Web extension metadata (URL, title of the captured page) */
  metadata?: {
    url?: string
    title?: string
    capturedAt?: string
  }
}

// ─── Web Capture ──────────────────────────────────────────────────

export type CaptureSource = 'bookmarklet' | 'extension' | 'api'

export interface WebCapture {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid
  sourceUrl: string
  title: string
  content: string
  screenshot: string | null
  source: CaptureSource
  tags: string[]
  fileId: Uuid | null
  analyzed: boolean
  analysisResult: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: Date
}

// ─── Capture & Ask ───────────────────────────────────────────────

export type CaptureAskSource =
  | 'canvas'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'notes'
  | 'file_browser'
  | 'timeline'
  | 'dashboard'
  | 'chat'
  | 'agents'
  | 'knowledge'
  | 'captures'
  | 'other'

export interface CaptureContext {
  /** Base64 data URL initially; replaced by S3 URL after backend upload */
  imageBase64: string
  /** S3 download URL set by the backend after storage */
  imageUrl?: string
  captureSource: CaptureAskSource
  sourceFileId: string | null
  sourceFileName: string | null
  captureRegion: { x: number; y: number; width: number; height: number }
  currentUrl: string
  timestamp: string
  /** Canvas only: IDs of objects visible in the captured region */
  visibleObjectIds?: string[]
}

// ─── Multi-Mode Capture ──────────────────────────────────────────

export type CaptureMode =
  | 'passive' // Auto-capture on page visits (title + URL + meta)
  | 'screenshot' // Manual screenshot with annotation
  | 'full_page' // Full page content extraction
  | 'clip' // User-selected region
  | 'agent_browse' // Agent browsing session capture

export interface BrowsingContext {
  sessionId: string
  agentRunId?: string
  workspaceId: string
  visits: BrowsingVisit[]
  startedAt: string
  endedAt?: string
  summary?: string
  findings?: string[]
}

export interface BrowsingVisit {
  url: string
  title: string
  excerpt: string
  timestamp: string
  durationMs: number
  captureMode: CaptureMode
  tags?: string[]
}

// ─── Realtime Capture ─────────────────────────────────────────────

export type RealtimeCaptureSource = 'in_app' | 'web_extension'

export interface RealtimeCapturePayload {
  workspaceId: string
  userId: string
  sessionId: string
  source: RealtimeCaptureSource
  screenshot?: string // base64 PNG
  actions?: {
    // structured actions (in-app only)
    type: string
    objectId: string
    objectType: string
    details: Record<string, unknown>
    timestamp: string
    sessionId: string
  }[]
  webContext?: {
    // web extension only
    url: string
    title: string
    domain: string
  }
  timestamp: string // ISO
}

export interface MessageMetadata {
  model?: string
  tokensIn?: number
  tokensOut?: number
  latencyMs?: number
  toolCalls?: ToolCallRecord[]
  feedback?: 'positive' | 'negative'
  [key: string]: unknown
}

export interface ToolCallRecord {
  tool: string
  params: Record<string, unknown>
  result: unknown
  durationMs: number
}

export interface DeepDiveBookmark {
  id: Uuid
  conversationId: Uuid
  messageId: Uuid
  userId: Uuid
  note: string | null
  createdAt: Date
}

// ─── Knowledge ─────────────────────────────────────────────────────

export type KnowledgeDocType =
  | 'user_profile'
  | 'topic_summary'
  | 'decision_log'
  | 'project_state'
  | 'agent_playbook'

export interface KnowledgeDoc {
  id: Uuid
  workspaceId: Uuid
  docType: string
  content: Record<string, unknown>
  sourceSummaries: Uuid[]
  sourceAgentRuns: Uuid[]
  lastUpdated: Date
  accessScope: string
  embedding: number[] | null
}

// ─── Knowledge Graph ──────────────────────────────────────────────────

export type KnowledgeEntityType = 'user' | 'file' | 'topic' | 'decision' | 'project'

export type KnowledgeRelationship =
  | 'created'
  | 'edited'
  | 'reviewed'
  | 'decided'
  | 'collaborates_with'
  | 'belongs_to'
  | 'references'
  | 'depends_on'
  | 'supersedes'

export interface KnowledgeEdge {
  id: Uuid
  workspaceId: Uuid
  sourceType: KnowledgeEntityType
  sourceId: Uuid
  relationship: KnowledgeRelationship
  targetType: KnowledgeEntityType
  targetId: Uuid
  weight: number
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

// ─── Collaboration ────────────────────────────────────────────────────

export type FileSharePermission = 'viewer' | 'editor'

export interface FileShare {
  id: Uuid
  fileId: Uuid
  userId: Uuid | null
  permission: FileSharePermission
  sharedBy: Uuid
  shareToken: string | null
  createdAt: Date
}

export type NotificationType =
  | 'mention'
  | 'comment'
  | 'share'
  | 'invite'
  | 'agent_complete'
  | 'prompt_card'
  | 'system'

export interface Notification {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid
  type: NotificationType
  title: string
  body: string
  link: string | null
  metadata: Record<string, unknown>
  read: boolean
  createdAt: Date
}

export interface Comment {
  id: Uuid
  workspaceId: Uuid
  fileId: Uuid
  userId: Uuid
  parentCommentId: Uuid | null
  content: string
  position: Record<string, unknown> | null
  resolved: boolean
  resolvedBy: Uuid | null
  createdAt: Date
  updatedAt: Date
}

export interface Webhook {
  id: Uuid
  workspaceId: Uuid
  url: string
  events: string[]
  secret: string
  active: boolean
  createdBy: Uuid
  createdAt: Date
}

export interface ApiKey {
  id: Uuid
  workspaceId: Uuid
  name: string
  keyHash: string
  keyPrefix: string
  permissions: string[]
  lastUsedAt: Date | null
  createdBy: Uuid
  createdAt: Date
  expiresAt: Date | null
}

// ─── Recording Sessions ──────────────────────────────────────────────

export type RecordingSessionStatus = 'active' | 'completed' | 'abandoned'

export interface RecordingSession {
  id: Uuid
  workspaceId: Uuid
  userId: Uuid
  sessionId: string
  status: RecordingSessionStatus
  startedAt: Date
  endedAt: Date | null
  durationMs: number | null
  eventCount: number
  summaryText: string | null
  topics: string[] | null
  intent: string | null
  metrics: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: Date
}
