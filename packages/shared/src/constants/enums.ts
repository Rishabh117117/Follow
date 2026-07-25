export const USER_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export const WORKSPACE_VISIBILITY = ['private', 'team', 'public'] as const
export const FILE_TYPES = ['file', 'folder'] as const
export const FILE_STATUSES = ['active', 'archived', 'deleted'] as const
export const AGENT_STATUSES = ['idle', 'running', 'completed', 'failed', 'cancelled'] as const
export const TIMELINE_RESOLUTIONS = ['30min', '1hr', '1day', '1week', '1month'] as const

export const TIMELINE_ACTION_TYPES = [
  'file_created',
  'file_updated',
  'file_deleted',
  'file_moved',
  'message_sent',
  'agent_run_started',
  'agent_run_completed',
  'member_joined',
  'member_left',
  'workspace_updated',
  'canvas_updated',
] as const

export const EMBEDDING_DIMENSIONS = 1536 as const
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB
export const MAX_WORKSPACE_MEMBERS = 100
