import { db } from '../../db/index'
import { notifications } from '../../db/schema/collaboration'
import { notifyUser } from '../../ws/index'

export type NotificationType =
  | 'mention'
  | 'comment'
  | 'share'
  | 'invite'
  | 'agent_complete'
  | 'prompt_card'
  | 'system'
  | 'tension'
  | 'conflict'

export interface EmitNotificationInput {
  workspaceId: string
  userId: string
  type: NotificationType
  title: string
  body?: string
  link?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Insert a notification row and push it via WebSocket to any live socket
 * the user has open. Safe to call from any route or background service.
 */
export async function emitNotification(input: EmitNotificationInput): Promise<void> {
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? '',
        link: input.link ?? null,
        metadata: input.metadata ?? {},
      })
      .returning()

    if (row) {
      notifyUser(input.workspaceId, input.userId, row as unknown as Record<string, unknown>)
    }
  } catch (err) {
    // Notifications must never break the request that triggered them
    console.warn('[emitNotification] failed:', (err as Error).message)
  }
}
