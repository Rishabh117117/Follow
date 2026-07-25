import { type NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

// In-memory conversation store for standalone demo mode
const conversations: Map<string, Record<string, unknown>> = new Map()

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  const all = Array.from(conversations.values())
  const filtered = workspaceId ? all.filter((c) => c.workspaceId === workspaceId) : all
  return NextResponse.json({
    data: filtered.sort(
      (a, b) =>
        new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime()
    ),
    error: null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const id = randomUUID()
  const now = new Date().toISOString()
  const conversation = {
    id,
    workspaceId: body.workspaceId ?? DEV_WORKSPACE.id,
    userId: DEV_USER.id,
    title: body.title ?? 'New Chat',
    type: body.type ?? 'standard',
    contextObjectId: body.contextObjectId ?? null,
    contextObjectType: body.contextObjectType ?? null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  conversations.set(id, conversation)
  return NextResponse.json({ data: conversation, error: null })
}
