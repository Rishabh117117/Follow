/**
 * MCP Server Types (Sprint MCP-1)
 *
 * Shared types for the Follow MCP server. The server implements
 * JSON-RPC 2.0 over SSE for tool-use by external AI clients.
 */

// ─── Session ────────────────────────────────────────────────────────

export interface MCPToolMetric {
  count: number
  totalLatencyMs: number
  errors: number
  lastCalledAt: Date | null
}

export interface MCPSession {
  userId: string
  workspaceId: string
  activeProjectId: string | null
  activeProjectScope: 'personal' | 'project'
  connectedAt: Date
  lastActivityAt: Date
  /** Client metadata (WIRE-1) */
  clientName: string
  transport: string
  toolCalls: Record<string, MCPToolMetric>
}

export interface MCPClientInfo {
  name: string
  transport: string
  lastSeen: string
  callCount: number
  connectedAt: string
}

export interface MCPToolAggregate {
  name: string
  calls: number
  avgLatency: number
  errors: number
  lastCalled: string | null
}

// ─── Tool System ────────────────────────────────────────────────────

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (
    params: Record<string, unknown>,
    session: MCPSession,
    deps: MCPDependencies
  ) => Promise<MCPToolResult>
}

export interface MCPDependencies {
  db: unknown
}

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

// ─── Chat Source ────────────────────────────────────────────────────

export type ChatSourceType =
  | 'follow-web'
  | 'follow-notebook'
  | 'claude'
  | 'chatgpt'
  | 'cursor'
  | 'custom'
