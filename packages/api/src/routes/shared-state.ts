import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { getOrCreateSharedState, updateSharedState } from '../services/ai-state/state-manager'

const sharedStateRouter = new Hono()
sharedStateRouter.use('*', authMiddleware)

// GET /:documentId — Read document shared state
sharedStateRouter.get('/:documentId', async (c) => {
  const documentId = c.req.param('documentId')
  const workspaceId = c.req.header('x-workspace-id') || ''

  const { state } = await getOrCreateSharedState(documentId, workspaceId)

  return c.json({ data: state, error: null })
})

// POST /:documentId/resolve-conflict — Resolve a knowledge conflict
sharedStateRouter.post('/:documentId/resolve-conflict', async (c) => {
  const documentId = c.req.param('documentId')
  const workspaceId = c.req.header('x-workspace-id') || ''
  const body = await c.req.json()

  const { tensionId, resolution, keepKnowledgeId, supersededKnowledgeId } = body

  if (!tensionId) {
    return c.json(
      { data: null, error: { code: 'INVALID', message: 'tensionId required' } },
      400
    )
  }

  await updateSharedState(documentId, workspaceId, (current) => {
    const updated = { ...current }

    const tension = updated.tensions.find((t: { id: string }) => t.id === tensionId)
    if (tension) {
      tension.resolvedAt = new Date().toISOString()
      tension.resolution = resolution || 'Resolved by user'
    }

    if (keepKnowledgeId) {
      const keep = updated.knowledge.find((k: { id: string }) => k.id === keepKnowledgeId)
      if (keep) {
        keep.status = 'active'
        keep.conflictsWith = null
      }
    }

    if (supersededKnowledgeId) {
      const superseded = updated.knowledge.find(
        (k: { id: string }) => k.id === supersededKnowledgeId
      )
      if (superseded) {
        superseded.status = 'superseded'
      }
    }

    return updated
  })

  return c.json({ data: { resolved: true }, error: null })
})

// POST /:documentId/add-knowledge — Manually add shared knowledge
sharedStateRouter.post('/:documentId/add-knowledge', async (c) => {
  const documentId = c.req.param('documentId')
  const workspaceId = c.req.header('x-workspace-id') || ''
  const userId = c.get('userId') as string
  const body = await c.req.json()

  const { fact, source, linkedSection, userName } = body

  if (!fact) {
    return c.json(
      { data: null, error: { code: 'INVALID', message: 'fact required' } },
      400
    )
  }

  await updateSharedState(documentId, workspaceId, (current) => {
    const updated = { ...current }

    updated.knowledge.push({
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fact: fact.slice(0, 300),
      source: source || 'Manual entry',
      confidence: 1.0,
      contributedBy: userId,
      contributedByName: userName || 'Unknown',
      sharedAt: new Date().toISOString(),
      method: 'intentional',
      linkedSection: linkedSection || null,
      conflictsWith: null,
      status: 'active',
    })

    if (updated.knowledge.length > 30) {
      updated.knowledge.sort(
        (a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence
      )
      updated.knowledge = updated.knowledge.slice(0, 30)
    }

    return updated
  })

  return c.json({ data: { added: true }, error: null })
})

export { sharedStateRouter }
