/**
 * MCP Server — JSON-RPC 2.0 Handler (Sprint MCP-1)
 *
 * Handles MCP protocol messages: initialize, tools/list, tools/call, ping.
 * Does NOT manage transport — that's in transport.ts.
 */

import type {
  MCPSession,
  MCPDependencies,
  MCPToolDefinition,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types'
import { mcpTools } from './tools/index'

const SERVER_INFO = {
  name: 'follow-mcp',
  version: '1.0.0',
  protocolVersion: '2024-11-05',
}

const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
}

// ─── JSON-RPC Helpers ──────────────────────────────────────────────

function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

// ─── Method Handlers ───────────────────────────────────────────────

function handleInitialize(id: string | number | null): JsonRpcResponse {
  return jsonRpcResult(id, {
    protocolVersion: SERVER_INFO.protocolVersion,
    capabilities: SERVER_CAPABILITIES,
    serverInfo: {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
    },
  })
}

function handlePing(id: string | number | null): JsonRpcResponse {
  return jsonRpcResult(id, {})
}

function handleToolsList(id: string | number | null, tools: MCPToolDefinition[]): JsonRpcResponse {
  return jsonRpcResult(id, {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  })
}

async function handleToolCall(
  id: string | number | null,
  params: Record<string, unknown>,
  session: MCPSession,
  deps: MCPDependencies,
  tools: MCPToolDefinition[]
): Promise<JsonRpcResponse> {
  const toolName = params.name as string | undefined
  const toolArgs = (params.arguments as Record<string, unknown>) ?? {}

  if (!toolName) {
    return jsonRpcError(id, -32602, 'Missing required parameter: name')
  }

  const tool = tools.find((t) => t.name === toolName)
  if (!tool) {
    return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`)
  }

  try {
    const result = await tool.handler(toolArgs, session, deps)
    return jsonRpcResult(id, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed'
    return jsonRpcResult(id, {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    })
  }
}

// ─── Main Dispatcher ───────────────────────────────────────────────

export async function handleMCPRequest(
  request: JsonRpcRequest,
  session: MCPSession,
  deps: MCPDependencies
): Promise<JsonRpcResponse> {
  const { method, id, params } = request

  switch (method) {
    case 'initialize':
      return handleInitialize(id)

    case 'notifications/initialized':
      // Client acknowledgment — no response needed for notifications
      return jsonRpcResult(id, {})

    case 'ping':
      return handlePing(id)

    case 'tools/list':
      return handleToolsList(id, mcpTools)

    case 'tools/call':
      if (!params) {
        return jsonRpcError(id, -32602, 'Missing params for tools/call')
      }
      return handleToolCall(id, params, session, deps, mcpTools)

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`)
  }
}

export { SERVER_INFO }
