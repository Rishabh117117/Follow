import { type NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getAllFiles, createFile } from './_store'

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId') ?? undefined
  return NextResponse.json({ data: getAllFiles(workspaceId), error: null })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const file = createFile({ id: randomUUID(), ...body })
  return NextResponse.json({ data: file, error: null })
}
