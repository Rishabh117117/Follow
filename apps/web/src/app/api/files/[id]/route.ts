import { type NextRequest, NextResponse } from 'next/server'
import { getFile, updateFile, deleteFile } from '../_store'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const file = getFile(id)
  if (!file) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'File not found' } },
      { status: 404 }
    )
  }
  return NextResponse.json({ data: file, error: null })
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const body = await req.json()
  const file = updateFile(id, body)
  if (!file) {
    return NextResponse.json(
      { data: null, error: { code: 'NOT_FOUND', message: 'File not found' } },
      { status: 404 }
    )
  }
  return NextResponse.json({ data: file, error: null })
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params
  deleteFile(id)
  return NextResponse.json({ data: { success: true }, error: null })
}
