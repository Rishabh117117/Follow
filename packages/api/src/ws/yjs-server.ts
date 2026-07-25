import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const messageSync = 0
const messageAwareness = 1

interface DocConnection {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
}

const docs = new Map<string, DocConnection>()

function getOrCreateDoc(docName: string): DocConnection {
  const existing = docs.get(docName)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)

  awareness.setLocalState(null)

  const docConn: DocConnection = {
    doc,
    awareness,
    conns: new Map(),
  }

  // Clean up awareness when client disconnects
  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = added.concat(updated, removed)
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      )
      const message = encoding.toUint8Array(encoder)

      docConn.conns.forEach((_, conn) => {
        if (conn.readyState === WebSocket.OPEN) {
          conn.send(message)
        }
      })
    }
  )

  docs.set(docName, docConn)
  return docConn
}

function removeConnection(docConn: DocConnection, conn: WebSocket): void {
  const controlledIds = docConn.conns.get(conn)
  docConn.conns.delete(conn)

  if (controlledIds) {
    awarenessProtocol.removeAwarenessStates(docConn.awareness, Array.from(controlledIds), null)
  }

  // Garbage collect: if no connections left, persist and remove
  if (docConn.conns.size === 0) {
    // We keep the doc in memory for a bit in case someone reconnects
    // In production, persist to DB here
    const docName = Array.from(docs.entries()).find(([, dc]) => dc === docConn)?.[0]
    if (docName) {
      setTimeout(() => {
        const current = docs.get(docName)
        if (current && current.conns.size === 0) {
          current.doc.destroy()
          docs.delete(docName)
          console.info(`[Yjs] Document "${docName}" garbage collected`)
        }
      }, 30000) // Keep for 30s after last disconnect
    }
  }
}

function handleMessage(conn: WebSocket, docConn: DocConnection, message: Uint8Array): void {
  const decoder = decoding.createDecoder(message)
  const messageType = decoding.readVarUint(decoder)

  switch (messageType) {
    case messageSync: {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.readSyncMessage(decoder, encoder, docConn.doc, conn)

      if (encoding.length(encoder) > 1) {
        conn.send(encoding.toUint8Array(encoder))
      }
      break
    }

    case messageAwareness: {
      const update = decoding.readVarUint8Array(decoder)
      awarenessProtocol.applyAwarenessUpdate(docConn.awareness, update, conn)
      break
    }

    default:
      break
  }
}

function setupConnection(conn: WebSocket, docConn: DocConnection): void {
  docConn.conns.set(conn, new Set())

  // Send initial sync step 1
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeSyncStep1(encoder, docConn.doc)
  conn.send(encoding.toUint8Array(encoder))

  // Send current awareness states
  const awarenessStates = docConn.awareness.getStates()
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder()
    encoding.writeVarUint(awarenessEncoder, messageAwareness)
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(docConn.awareness, Array.from(awarenessStates.keys()))
    )
    conn.send(encoding.toUint8Array(awarenessEncoder))
  }

  conn.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const message =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : Array.isArray(data)
            ? Buffer.concat(data)
            : new Uint8Array(data)
      handleMessage(conn, docConn, message)
    } catch (err) {
      console.error('[Yjs] Error handling message:', err)
    }
  })

  conn.on('close', () => {
    removeConnection(docConn, conn)
  })

  conn.on('error', (err) => {
    console.error('[Yjs] Connection error:', err.message)
    removeConnection(docConn, conn)
  })
}

/**
 * Get a Y.Doc snapshot for persisting.
 * Returns the encoded state as Uint8Array.
 */
export function getDocState(docName: string): Uint8Array | null {
  const docConn = docs.get(docName)
  if (!docConn) return null
  return Y.encodeStateAsUpdate(docConn.doc)
}

/**
 * Load a Y.Doc from a persisted state.
 */
export function loadDocState(docName: string, state: Uint8Array): void {
  const docConn = getOrCreateDoc(docName)
  Y.applyUpdate(docConn.doc, state)
}

/**
 * Get the number of active connections for a document.
 */
export function getDocConnectionCount(docName: string): number {
  const docConn = docs.get(docName)
  return docConn?.conns.size ?? 0
}

/**
 * Get all active document names.
 */
export function getActiveDocNames(): string[] {
  return Array.from(docs.keys())
}

export function createYjsWebSocketServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port })

  wss.on('connection', (conn: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `ws://localhost:${port}`)
    const docName = url.searchParams.get('doc') ?? url.pathname.slice(1)

    if (!docName) {
      conn.close(4400, 'Missing document name')
      return
    }

    const docConn = getOrCreateDoc(docName)
    setupConnection(conn, docConn)

    console.info(`[Yjs] Client connected to "${docName}" (${docConn.conns.size} total)`)
  })

  wss.on('listening', () => {
    console.info(`[Yjs] Collaboration server running on ws://localhost:${port}`)
  })

  wss.on('error', (err) => {
    console.error('[Yjs] Server error:', err.message)
  })

  return wss
}
