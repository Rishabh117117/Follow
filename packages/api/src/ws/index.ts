import { WebSocketServer, WebSocket } from 'ws'
import { redis } from '../redis/index'
import { DEV_WORKSPACE } from '@workspace/shared/constants'

export interface WsClient {
  id: string
  userId: string
  workspaceId: string
  socket: WebSocket
  joinedAt: Date
}

interface WsMessage {
  type: string
  room?: string
  payload?: Record<string, unknown>
}

const rooms = new Map<string, Set<WsClient>>()
const clients = new Map<string, WsClient>()

export function joinRoom(roomId: string, client: WsClient): void {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set())
  }
  rooms.get(roomId)!.add(client)
}

export function leaveRoom(roomId: string, client: WsClient): void {
  const room = rooms.get(roomId)
  if (room) {
    room.delete(client)
    if (room.size === 0) {
      rooms.delete(roomId)
    }
  }
}

export function broadcast(roomId: string, message: WsMessage, excludeClientId?: string): void {
  const room = rooms.get(roomId)
  if (!room) return

  const data = JSON.stringify(message)
  for (const client of room) {
    if (client.id !== excludeClientId && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(data)
    }
  }
}

export function sendToClient(clientId: string, message: WsMessage): void {
  const client = clients.get(clientId)
  if (client && client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify(message))
  }
}

function removeClient(client: WsClient): void {
  // Capture group rooms this client was in so we can announce them as offline
  const groupRoomsLeft: string[] = []
  for (const [roomId, room] of rooms) {
    if (room.has(client)) {
      if (roomId.startsWith('group:')) groupRoomsLeft.push(roomId)
      room.delete(client)
    }
  }
  // Clean up empty rooms
  for (const [roomId, room] of rooms) {
    if (room.size === 0) rooms.delete(roomId)
  }
  clients.delete(client.id)

  // Announce group offline to any rooms the client was in
  for (const roomId of groupRoomsLeft) {
    broadcast(roomId, {
      type: 'group_member_offline',
      room: roomId,
      payload: { userId: client.userId, conversationId: roomId.replace(/^group:/, '') },
    })
  }

  // Remove presence
  redis.del(`presence:${client.workspaceId}:${client.userId}`).catch(() => {})

  // Broadcast offline status
  broadcast(`workspace:${client.workspaceId}`, {
    type: 'presence_offline',
    payload: { userId: client.userId },
  })
}

function setPresence(client: WsClient, context?: string): void {
  redis
    .setex(`presence:${client.workspaceId}:${client.userId}`, 60, context ?? 'online')
    .catch(() => {})
}

/**
 * Send a notification to all open sockets owned by `userId` in `workspaceId`.
 * Falls back silently if the user has no live sockets — they'll see it on next poll.
 */
export function notifyUser(
  workspaceId: string,
  userId: string,
  payload: Record<string, unknown>
): void {
  const room = rooms.get(`workspace:${workspaceId}`)
  if (!room) return
  const data = JSON.stringify({ type: 'notification', payload })
  for (const client of room) {
    if (client.userId === userId && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(data)
    }
  }
}

function handleMessage(client: WsClient, raw: string): void {
  let message: WsMessage
  try {
    message = JSON.parse(raw) as WsMessage
  } catch {
    client.socket.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }))
    return
  }

  switch (message.type) {
    case 'join': {
      const roomId = message.room
      if (roomId) {
        joinRoom(roomId, client)
        client.socket.send(JSON.stringify({ type: 'joined', room: roomId }))
      }
      break
    }

    case 'leave': {
      const roomId = message.room
      if (roomId) {
        leaveRoom(roomId, client)
        client.socket.send(JSON.stringify({ type: 'left', room: roomId }))
      }
      break
    }

    case 'broadcast': {
      const roomId = message.room
      if (roomId) {
        broadcast(
          roomId,
          {
            type: 'message',
            room: roomId,
            payload: { ...message.payload, from: client.userId },
          },
          client.id
        )
      }
      break
    }

    case 'heartbeat': {
      // Refresh presence TTL
      const context = (message.payload?.context as string) ?? 'online'
      setPresence(client, context)
      client.socket.send(JSON.stringify({ type: 'heartbeat_ack' }))
      break
    }

    case 'presence_update': {
      const context = (message.payload?.context as string) ?? 'online'
      setPresence(client, context)
      broadcast(`workspace:${client.workspaceId}`, {
        type: 'presence_update',
        payload: { userId: client.userId, context },
      })
      break
    }

    case 'document_focus': {
      const documentId = (message.payload?.documentId as string | null) ?? null
      const context = JSON.stringify({ activeDocumentId: documentId })
      setPresence(client, context)
      broadcast(`workspace:${client.workspaceId}`, {
        type: 'presence_update',
        payload: { userId: client.userId, activeDocumentId: documentId },
      })
      break
    }

    case 'group_typing': {
      // Broadcast typing indicator to other group members
      const conversationId = message.payload?.conversationId as string | undefined
      const userName = message.payload?.userName as string | undefined
      if (conversationId) {
        broadcast(
          `group:${conversationId}`,
          {
            type: 'group_typing',
            room: `group:${conversationId}`,
            payload: { userId: client.userId, userName, conversationId },
          },
          client.id
        )
      }
      break
    }

    case 'group_join': {
      // Convenience: join the group room and broadcast member_online
      const conversationId = message.payload?.conversationId as string | undefined
      if (conversationId) {
        const roomId = `group:${conversationId}`
        joinRoom(roomId, client)
        broadcast(
          roomId,
          {
            type: 'group_member_online',
            room: roomId,
            payload: { userId: client.userId, conversationId },
          },
          client.id
        )
        // Echo current online list to the joiner
        const room = rooms.get(roomId)
        const online = room
          ? Array.from(new Set(Array.from(room).map((c) => c.userId)))
          : [client.userId]
        client.socket.send(
          JSON.stringify({
            type: 'group_online_list',
            room: roomId,
            payload: { conversationId, online },
          })
        )
      }
      break
    }

    case 'group_leave': {
      const conversationId = message.payload?.conversationId as string | undefined
      if (conversationId) {
        const roomId = `group:${conversationId}`
        leaveRoom(roomId, client)
        broadcast(roomId, {
          type: 'group_member_offline',
          room: roomId,
          payload: { userId: client.userId, conversationId },
        })
      }
      break
    }

    case 'group_message_sent': {
      // Notify other clients in the group room that a new persisted message exists.
      // Listeners refetch /messages instead of carrying the body over the WS bus.
      const conversationId = message.payload?.conversationId as string | undefined
      if (conversationId) {
        broadcast(
          `group:${conversationId}`,
          {
            type: 'group_message_sent',
            room: `group:${conversationId}`,
            payload: { conversationId, byUserId: client.userId },
          },
          client.id
        )
      }
      break
    }

    case 'ping': {
      client.socket.send(JSON.stringify({ type: 'pong' }))
      break
    }

    default: {
      client.socket.send(
        JSON.stringify({
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
        })
      )
    }
  }
}

let clientIdCounter = 0

export function createWebSocketServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

  wss.on('connection', (socket: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `ws://localhost:${port}`)
    const userId = url.searchParams.get('userId') ?? 'anonymous'
    const workspaceId = url.searchParams.get('workspaceId') ?? DEV_WORKSPACE.id

    clientIdCounter += 1
    const clientId = `ws_${clientIdCounter}_${Date.now()}`

    const client: WsClient = {
      id: clientId,
      userId,
      workspaceId,
      socket,
      joinedAt: new Date(),
    }

    clients.set(clientId, client)

    socket.send(
      JSON.stringify({
        type: 'connected',
        payload: { clientId, userId, workspaceId },
      })
    )

    // Auto-join workspace room and timeline channel
    joinRoom(`workspace:${workspaceId}`, client)
    joinRoom(`timeline:${workspaceId}`, client)

    // Set presence
    setPresence(client)
    broadcast(`workspace:${workspaceId}`, {
      type: 'presence_online',
      payload: { userId },
    })

    socket.on('message', (data) => {
      handleMessage(client, data.toString())
    })

    socket.on('close', () => {
      removeClient(client)
    })

    socket.on('error', (err) => {
      console.error(`[WS] Client ${clientId} error:`, err.message)
      removeClient(client)
    })
  })

  wss.on('listening', () => {
    console.info(`[WS] WebSocket server running on ws://localhost:${port}`)
  })

  wss.on('error', (err) => {
    console.error('[WS] Server error:', err.message)
  })

  return wss
}
