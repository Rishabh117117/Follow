export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolName?: string
}

export interface AgentContext {
  workspaceId: string
  userId: string
  conversationId: string
  messages: AgentMessage[]
}

export interface OrchestratorConfig {
  model: string
  systemPrompt: string
  tools: string[]
  maxIterations: number
  temperature?: number
}

export interface OrchestratorResult {
  messages: AgentMessage[]
  finalOutput: string
  toolCallCount: number
  completedAt: Date
}
