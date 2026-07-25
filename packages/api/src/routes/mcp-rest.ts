/**
 * MCP REST Wrappers (Sprint DEPLOY-1)
 *
 * REST endpoints that wrap MCP tools for ChatGPT Actions compatibility.
 * Each tool becomes a POST endpoint: /api/mcp-rest/{tool-name}
 * Pure pass-through — no new logic, just HTTP → MCP tool adapter.
 */

import { Hono } from 'hono'
import { createFlexAuthMiddleware } from '../middleware/api-key-auth'
import { authMiddleware } from '../middleware/auth'
import { mcpTools } from '../mcp/tools/index'
import { getOrCreateSession, recordToolCall } from '../mcp/transport'
import { assertWorkspaceAccess } from '../services/workspace-access'
import type { MCPDependencies } from '../mcp/types'

function inferRestClientName(userAgent: string | undefined): string {
  const ua = (userAgent || '').toLowerCase()
  if (ua.includes('chatgpt') || ua.includes('openai')) return 'ChatGPT'
  if (ua.includes('claude')) return 'Claude'
  if (ua.includes('follow-agent') || ua.includes('desktop-agent')) return 'Desktop Agent'
  return 'REST Client'
}

export const mcpRestRouter = new Hono()

// CORS for external clients
mcpRestRouter.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('ngrok-skip-browser-warning', 'true')
  await next()
})

mcpRestRouter.options('*', (c) => {
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  c.header('Access-Control-Max-Age', '86400')
  return c.body(null, 204)
})

// Auth
const flexAuth = createFlexAuthMiddleware(authMiddleware)
mcpRestRouter.use('*', flexAuth)

// Generate a POST endpoint for each MCP tool
for (const tool of mcpTools) {
  const routeName = tool.name.replace(/_/g, '-') // query_index → query-index

  mcpRestRouter.post(`/${routeName}`, async (c) => {
    const userId = c.get('userId') as string
    const workspaceId = (c.get('workspaceId') as string) ?? ''
    const clientName = inferRestClientName(c.req.header('user-agent'))

    let body: Record<string, unknown> = {}
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      // Empty body is fine for tools with no required params
    }

    if (workspaceId) {
      const denied = await assertWorkspaceAccess(c, workspaceId)
      if (denied) return denied
    }

    const session = await getOrCreateSession(userId, workspaceId, {
      clientName,
      transport: 'REST/OpenAPI',
    })
    const deps: MCPDependencies = { db: (await import('../db/index')).db }

    const startedAt = Date.now()
    try {
      const result = await tool.handler(body, session, deps)
      recordToolCall(session, tool.name, Date.now() - startedAt, !!result.isError)
      return c.json({ data: result, error: null })
    } catch (err) {
      recordToolCall(session, tool.name, Date.now() - startedAt, true)
      return c.json(
        {
          data: null,
          error: {
            code: 'TOOL_ERROR',
            message: err instanceof Error ? err.message : 'Unknown error',
          },
        },
        500
      )
    }
  })
}
