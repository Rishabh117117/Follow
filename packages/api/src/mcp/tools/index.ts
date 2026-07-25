/**
 * MCP Tools Registry (Sprint MCP-1, MCP-2)
 *
 * Barrel file that exports all registered MCP tools.
 */

import type { MCPToolDefinition } from '../types'
import { queryIndexTool } from './query-index'
import { setScopeTool } from './set-scope'
import { saveConversationTool } from './save-conversation'
import { readFileTool } from './read-file'
import { contributeTool } from './contribute'
import { sendMessageTool } from './send-message'
import { sendConversationTool } from './send-conversation'
import { getActivityTool } from './get-activity'
import { detectContradictionsTool } from './detect-contradictions'
import { directoryQueryTool } from './directory-query'
import { scopeConfigureTool } from './scope-configure'
import { discoverSimilarTool } from './discover-similar'

export const mcpTools: MCPToolDefinition[] = [
  queryIndexTool,
  setScopeTool,
  saveConversationTool,
  readFileTool,
  contributeTool,
  sendMessageTool,
  sendConversationTool,
  getActivityTool,
  detectContradictionsTool,
  directoryQueryTool,
  scopeConfigureTool,
  discoverSimilarTool,
]
