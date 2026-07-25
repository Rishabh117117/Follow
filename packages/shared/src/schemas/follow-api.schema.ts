/**
 * FollowAPI port (ADAPTER-1 · 2026-06-02)
 *
 * A window-agnostic backend contract: one typed interface + per-operation Zod
 * request/response schemas that both the web `api-client` adapter and the Hono
 * backend converge on. Operations mirror the MCP tools (query_index,
 * contribute, get_activity, detect_contradictions, set_scope, read_file,
 * directory_query, send_message, save_conversation).
 *
 * Also defines the `QuerySpec` discriminated union (point | regional |
 * directional | trajectory | contrastive) — **schema only**; the query modes
 * are not implemented in this sprint.
 */

import { z } from 'zod'

// ─── QuerySpec (schema only — modes not implemented here) ────────────────────

export const QueryModeSchema = z.enum([
  'point',
  'regional',
  'directional',
  'trajectory',
  'contrastive',
])
export type QueryMode = z.infer<typeof QueryModeSchema>

/** A single point and its neighbourhood. */
export const PointQuerySchema = z.object({
  mode: z.literal('point'),
  target: z.string(), // anchor/record id or natural-language seed
  radius: z.number().optional(),
})
/** A topical region of the graph. */
export const RegionalQuerySchema = z.object({
  mode: z.literal('regional'),
  region: z.string(),
  limit: z.number().int().positive().optional(),
})
/** Follow edges of a given kind out from a node. */
export const DirectionalQuerySchema = z.object({
  mode: z.literal('directional'),
  from: z.string(),
  edgeKind: z.string().optional(),
  depth: z.number().int().positive().optional(),
})
/** A path across time/edges from a node. */
export const TrajectoryQuerySchema = z.object({
  mode: z.literal('trajectory'),
  from: z.string(),
  steps: z.number().int().positive().optional(),
  since: z.string().optional(),
})
/** Contrast two nodes/regions. */
export const ContrastiveQuerySchema = z.object({
  mode: z.literal('contrastive'),
  a: z.string(),
  b: z.string(),
})

export const QuerySpecSchema = z.discriminatedUnion('mode', [
  PointQuerySchema,
  RegionalQuerySchema,
  DirectionalQuerySchema,
  TrajectoryQuerySchema,
  ContrastiveQuerySchema,
])
export type QuerySpec = z.infer<typeof QuerySpecSchema>

// ─── Shared fragments ────────────────────────────────────────────────────────

const ScopeEnum = z.enum(['personal', 'project', 'auto'])
const Boundaries = z.array(z.unknown()).optional()

// ─── Per-operation request / response schemas ────────────────────────────────

export const QueryRequestSchema = z.object({
  query: z.string().optional(),
  scope: ScopeEnum.optional(),
  max_results: z.number().int().positive().optional(),
  boundaries: Boundaries,
  /** structured query (ADAPTER-1) — schema only */
  spec: QuerySpecSchema.optional(),
})
export const QueryResponseSchema = z.object({
  results: z.array(z.unknown()),
  scope: z.string().optional(),
})

export const ContributeRequestSchema = z.object({
  items: z.array(z.string()).optional(),
  scope_query: z.string().optional(),
  privacy_preset: z.enum(['open', 'balanced', 'private']).optional(),
  include_raw_files: z.boolean().optional(),
})
export const ContributeResponseSchema = z.object({
  contributed: z.number().int().nonnegative().optional(),
  items: z.array(z.string()).optional(),
})

export const GetActivityRequestSchema = z.object({
  scope: ScopeEnum.optional(),
  since: z.string().optional(),
  type: z.enum(['all', 'contributions', 'contradictions', 'messages', 'ingestions']).optional(),
  boundaries: Boundaries,
})
export const GetActivityResponseSchema = z.object({
  items: z.array(z.unknown()),
})

export const DetectContradictionsRequestSchema = z.object({
  topic: z.string().optional(),
  include_resolved: z.boolean().optional(),
  boundaries: Boundaries,
})
export const DetectContradictionsResponseSchema = z.object({
  contradictions: z.array(z.unknown()),
})

export const SetScopeRequestSchema = z.object({
  project_id: z.string(),
})
export const SetScopeResponseSchema = z.object({
  scope: z.string(),
})

export const ReadFileRequestSchema = z.object({
  file_name: z.string().optional(),
  file_id: z.string().optional(),
  version: z.enum(['latest', 'all']).optional(),
  boundaries: Boundaries,
})
export const ReadFileResponseSchema = z.object({
  file: z.unknown().optional(),
  content: z.string().optional(),
})

export const DirectoryQueryRequestSchema = z.object({
  topic: z.string(),
  scope: z.string().optional(),
  include_contradictions: z.boolean().optional(),
  max_contributors: z.number().int().positive().optional(),
})
export const DirectoryQueryResponseSchema = z.object({
  contributors: z.array(z.unknown()),
  sources: z.array(z.unknown()).optional(),
})

export const SendMessageRequestSchema = z.object({
  to: z.string(),
  content: z.string(),
  reference_items: z.array(z.string()).optional(),
})
export const SendMessageResponseSchema = z.object({
  ok: z.boolean(),
})

export const SaveConversationRequestSchema = z.object({
  messages: z.array(z.unknown()),
  source_type: z.string(),
  conversation_id: z.string().optional(),
  title: z.string().optional(),
})
export const SaveConversationResponseSchema = z.object({
  conversationId: z.string().optional(),
  ok: z.boolean().optional(),
})

// ─── Operation registry (used by the contract test as the single source) ─────

export const FOLLOW_API_OPERATIONS = {
  query: { tool: 'query_index', request: QueryRequestSchema, response: QueryResponseSchema },
  contribute: {
    tool: 'contribute',
    request: ContributeRequestSchema,
    response: ContributeResponseSchema,
  },
  getActivity: {
    tool: 'get_activity',
    request: GetActivityRequestSchema,
    response: GetActivityResponseSchema,
  },
  detectContradictions: {
    tool: 'detect_contradictions',
    request: DetectContradictionsRequestSchema,
    response: DetectContradictionsResponseSchema,
  },
  setScope: { tool: 'set_scope', request: SetScopeRequestSchema, response: SetScopeResponseSchema },
  readFile: { tool: 'read_file', request: ReadFileRequestSchema, response: ReadFileResponseSchema },
  directoryQuery: {
    tool: 'directory_query',
    request: DirectoryQueryRequestSchema,
    response: DirectoryQueryResponseSchema,
  },
  sendMessage: {
    tool: 'send_message',
    request: SendMessageRequestSchema,
    response: SendMessageResponseSchema,
  },
  saveConversation: {
    tool: 'save_conversation',
    request: SaveConversationRequestSchema,
    response: SaveConversationResponseSchema,
  },
} as const

// ─── Inferred request/response types ─────────────────────────────────────────

export type QueryRequest = z.infer<typeof QueryRequestSchema>
export type QueryResponse = z.infer<typeof QueryResponseSchema>
export type ContributeRequest = z.infer<typeof ContributeRequestSchema>
export type ContributeResponse = z.infer<typeof ContributeResponseSchema>
export type GetActivityRequest = z.infer<typeof GetActivityRequestSchema>
export type GetActivityResponse = z.infer<typeof GetActivityResponseSchema>
export type DetectContradictionsRequest = z.infer<typeof DetectContradictionsRequestSchema>
export type DetectContradictionsResponse = z.infer<typeof DetectContradictionsResponseSchema>
export type SetScopeRequest = z.infer<typeof SetScopeRequestSchema>
export type SetScopeResponse = z.infer<typeof SetScopeResponseSchema>
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>
export type ReadFileResponse = z.infer<typeof ReadFileResponseSchema>
export type DirectoryQueryRequest = z.infer<typeof DirectoryQueryRequestSchema>
export type DirectoryQueryResponse = z.infer<typeof DirectoryQueryResponseSchema>
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>
export type SaveConversationRequest = z.infer<typeof SaveConversationRequestSchema>
export type SaveConversationResponse = z.infer<typeof SaveConversationResponseSchema>

// ─── The port ────────────────────────────────────────────────────────────────

export interface FollowAPI {
  query(req: QueryRequest): Promise<QueryResponse>
  contribute(req: ContributeRequest): Promise<ContributeResponse>
  getActivity(req: GetActivityRequest): Promise<GetActivityResponse>
  detectContradictions(req: DetectContradictionsRequest): Promise<DetectContradictionsResponse>
  setScope(req: SetScopeRequest): Promise<SetScopeResponse>
  readFile(req: ReadFileRequest): Promise<ReadFileResponse>
  directoryQuery(req: DirectoryQueryRequest): Promise<DirectoryQueryResponse>
  sendMessage(req: SendMessageRequest): Promise<SendMessageResponse>
  saveConversation(req: SaveConversationRequest): Promise<SaveConversationResponse>
}
