import { describe, it, expect, beforeAll } from 'vitest'
import type { Hono } from 'hono'
import { getTestApp, makeRequest, DEV_USER_ID, DEV_WORKSPACE_ID } from '../helpers/test-setup'

let app: Hono

beforeAll(async () => {
  app = await getTestApp()
}, 30_000)

describe('Integration: Health Check', () => {
  it('returns ok status', async () => {
    const { status, json } = await makeRequest(app, 'GET', '/health')
    expect(status).toBe(200)
    expect(json.status).toBe('ok')
    expect(json.timestamp).toBeDefined()
  })
})

describe('Integration: Files CRUD', () => {
  let fileId: string

  it('creates a file', async () => {
    const { status, json } = await makeRequest(app, 'POST', '/api/files', {
      workspaceId: DEV_WORKSPACE_ID,
      name: 'test-integration-file.md',
      type: 'file',
      mimeType: 'text/markdown',
      metadata: { content: '# Test File', editorType: 'note' },
    })
    expect(status).toBe(201)
    expect(json.data).toBeDefined()
    expect(json.data.name).toBe('test-integration-file.md')
    expect(json.error).toBeNull()
    fileId = json.data.id
  })

  it('lists files', async () => {
    const { status, json } = await makeRequest(
      app,
      'GET',
      `/api/files?workspaceId=${DEV_WORKSPACE_ID}`
    )
    expect(status).toBe(200)
    expect(json.data).toBeInstanceOf(Array)
    expect(json.data.length).toBeGreaterThanOrEqual(1)
  })

  it('reads a single file', async () => {
    const { status, json } = await makeRequest(app, 'GET', `/api/files/${fileId}`)
    expect(status).toBe(200)
    expect(json.data.id).toBe(fileId)
    expect(json.data.name).toBe('test-integration-file.md')
  })

  it('soft-deletes a file', async () => {
    const { status, json } = await makeRequest(app, 'DELETE', `/api/files/${fileId}`)
    expect(status).toBe(200)
    expect(json.data.id).toBe(fileId)
    expect(json.error).toBeNull()
  })
})

describe('Integration: Chat Conversations', () => {
  let conversationId: string

  it('creates a conversation', async () => {
    const { status, json } = await makeRequest(app, 'POST', '/api/chat/conversations', {
      workspaceId: DEV_WORKSPACE_ID,
      title: 'Integration Test Chat',
      type: 'standard',
    })
    expect(status).toBe(201)
    expect(json.data).toBeDefined()
    expect(json.data.title).toBe('Integration Test Chat')
    expect(json.data.status).toBe('active')
    conversationId = json.data.id
  })

  it('lists conversations', async () => {
    const { status, json } = await makeRequest(
      app,
      'GET',
      `/api/chat/conversations?workspaceId=${DEV_WORKSPACE_ID}`
    )
    expect(status).toBe(200)
    expect(json.data).toBeInstanceOf(Array)
    expect(json.data.some((c: { id: string }) => c.id === conversationId)).toBe(true)
  })

  it('gets a conversation by ID', async () => {
    const { status, json } = await makeRequest(
      app,
      'GET',
      `/api/chat/conversations/${conversationId}`
    )
    expect(status).toBe(200)
    expect(json.data.id).toBe(conversationId)
    expect(json.data.messages).toBeInstanceOf(Array)
  })

  it('archives a conversation', async () => {
    const { status, json } = await makeRequest(
      app,
      'DELETE',
      `/api/chat/conversations/${conversationId}`
    )
    expect(status).toBe(200)
    expect(json.data.success).toBe(true)
  })
})

describe('Integration: Notifications', () => {
  let notificationId: string

  it('creates a notification', async () => {
    const { status, json } = await makeRequest(app, 'POST', '/api/notifications', {
      workspaceId: DEV_WORKSPACE_ID,
      userId: DEV_USER_ID,
      type: 'system',
      title: 'Integration test notification',
      body: 'This is a test',
    })
    expect(status).toBe(201)
    expect(json.data).toBeDefined()
    notificationId = json.data.id
  })

  it('lists notifications', async () => {
    const { status, json } = await makeRequest(
      app,
      'GET',
      `/api/notifications?workspaceId=${DEV_WORKSPACE_ID}`
    )
    expect(status).toBe(200)
    expect(json.data).toBeInstanceOf(Array)
    expect(json.data.length).toBeGreaterThanOrEqual(1)
  })

  it('gets unread count', async () => {
    const { status, json } = await makeRequest(
      app,
      'GET',
      `/api/notifications/unread-count?workspaceId=${DEV_WORKSPACE_ID}`
    )
    expect(status).toBe(200)
    expect(json.data.count).toBeGreaterThanOrEqual(1)
  })

  it('marks notification as read', async () => {
    const { status, json } = await makeRequest(
      app,
      'PATCH',
      `/api/notifications/${notificationId}/read`
    )
    expect(status).toBe(200)
    expect(json.data.read).toBe(true)
    expect(json.error).toBeNull()
  })
})

describe('Integration: Knowledge', () => {
  it('gets knowledge docs (empty initially)', async () => {
    const { status, json } = await makeRequest(
      app,
      'GET',
      `/api/knowledge/docs?workspaceId=${DEV_WORKSPACE_ID}`
    )
    expect(status).toBe(200)
    expect(json.data).toBeInstanceOf(Array)
  })

  it('gets knowledge stats', async () => {
    const { status, json } = await makeRequest(
      app,
      'GET',
      `/api/knowledge/stats?workspaceId=${DEV_WORKSPACE_ID}`
    )
    expect(status).toBe(200)
    expect(json.data).toBeDefined()
  })
})

describe('Integration: Cross-service flow', () => {
  it('creates file then chat about it with file context', async () => {
    // Create file
    const { json: fileJson } = await makeRequest(app, 'POST', '/api/files', {
      workspaceId: DEV_WORKSPACE_ID,
      name: 'cross-service-test.md',
      type: 'file',
      mimeType: 'text/markdown',
      metadata: { content: '# Cross Service Test\n\nThis is a cross-service test.' },
    })
    const fileId = fileJson.data.id

    // Create conversation with file context
    const { json: convJson } = await makeRequest(app, 'POST', '/api/chat/conversations', {
      workspaceId: DEV_WORKSPACE_ID,
      type: 'standard',
      contextObjectId: fileId,
      contextObjectType: 'file',
    })

    expect(convJson.data.contextObjectId).toBe(fileId)
    expect(convJson.data.contextObjectType).toBe('file')

    // Clean up
    await makeRequest(app, 'DELETE', `/api/files/${fileId}`)
    await makeRequest(app, 'DELETE', `/api/chat/conversations/${convJson.data.id}`)
  })
})
