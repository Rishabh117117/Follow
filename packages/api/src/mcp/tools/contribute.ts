/**
 * MCP Tool: contribute (Sprint MCP-2)
 *
 * Pushes items from personal index to the active project index.
 * Wraps the existing sharing infrastructure (privacy filter + slice builder).
 */

import type { MCPToolDefinition, MCPToolResult, MCPSession } from '../types'
import { db } from '../../db/index'
import { eq } from 'drizzle-orm'
import { workspaces } from '../../db/schema/workspaces'

export const contributeTool: MCPToolDefinition = {
  name: 'contribute',
  description:
    'Push knowledge from your personal index to the active project index. Provide specific item IDs or describe what to share with scope_query to get recommendations first.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Array of index record IDs to contribute. If empty, Follow recommends items.',
        items: { type: 'string' },
      },
      scope_query: {
        type: 'string',
        description:
          "Natural language description of what to contribute. E.g., 'everything about pricing from this week'",
      },
      privacy_preset: {
        type: 'string',
        enum: ['open', 'balanced', 'private'],
        description: "Override the default privacy preset for this contribution. Default: user's active preset.",
      },
      include_raw_files: {
        type: 'boolean',
        description: 'Whether to include raw source files in the contribution. Default: true',
      },
    },
  },
  handler: contributeHandler,
}

async function contributeHandler(
  params: Record<string, unknown>,
  session: MCPSession
): Promise<MCPToolResult> {
  if (!session.activeProjectId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: No project scope is active. Call set_scope first to activate a project.',
        },
      ],
      isError: true,
    }
  }

  const items = (params.items as string[]) ?? []
  const scopeQuery = params.scope_query as string | undefined

  // Get project name
  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, session.activeProjectId))
    .limit(1)
  const projectName = workspace?.name ?? 'Unknown Project'

  // If no items and scope_query provided, recommend items
  if (items.length === 0 && scopeQuery) {
    try {
      const { executeIndexQuery } = await import(
        '../../services/semantic-index/query-executor'
      )

      const result = await executeIndexQuery({
        query: scopeQuery,
        workspaceId: session.workspaceId,
        userId: session.userId,
        limit: 10,
      })

      if (result.results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No items found matching "${scopeQuery}" in your personal index. Try a broader search or add content first.`,
            },
          ],
        }
      }

      let text = `Found ${result.results.length} item(s) matching "${scopeQuery}":\n\n`
      for (const item of result.results) {
        const title = item.documentTitle ?? 'Untitled'
        const score = (item.score * 100).toFixed(0)
        text += `- **${title}** (${score}% match, ID: ${item.id})\n`
        text += `  ${item.embeddingText.slice(0, 120)}...\n\n`
      }
      text += `To contribute these items, call contribute with the item IDs listed above.`

      return { content: [{ type: 'text', text }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return {
        content: [{ type: 'text', text: `Failed to search personal index: ${msg}` }],
        isError: true,
      }
    }
  }

  // If no items and no scope_query
  if (items.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: "Specify items to contribute or describe what to share with scope_query.",
        },
      ],
    }
  }

  // Contribute specified items
  try {
    const { buildSharedSlice } = await import('../../services/sharing/slice-builder')

    const result = await buildSharedSlice({
      fromUserId: session.userId,
      toUserId: session.userId, // Self-contribution to project
      workspaceId: session.activeProjectId,
      sessionToken: '', // MCP auth bypasses passcode for now
      scopeType: 'topic',
      query: `MCP contribution: ${items.length} items`,
      limit: items.length,
    })

    const summary = result.summary
    return {
      content: [
        {
          type: 'text',
          text: `Contributed ${summary?.itemsRetrieved ?? items.length} item(s) to ${projectName}.${
            summary?.redactionCount ? ` ${summary.redactionCount} item(s) filtered by privacy preset.` : ''
          }`,
        },
      ],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      content: [{ type: 'text', text: `Failed to contribute: ${msg}` }],
      isError: true,
    }
  }
}
