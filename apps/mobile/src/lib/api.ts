import Constants from 'expo-constants'
import { getUserId, getWorkspaceId } from './auth'

// Base URL comes from app.json -> expo.extra.apiUrl, overridable via env.
export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://localhost:3001'

export class ApiError extends Error {
  override readonly name = 'ApiError'
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message)
  }
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Json
  headers?: Record<string, string>
  signal?: AbortSignal
  /** When true, skip auth headers (for login endpoint). */
  anonymous?: boolean
}

async function buildHeaders(
  extra: Record<string, string> | undefined,
  anonymous: boolean,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  }
  if (!anonymous) {
    const userId = await getUserId()
    const workspaceId = await getWorkspaceId()
    if (userId) headers['x-user-id'] = userId
    if (workspaceId) headers['x-workspace-id'] = workspaceId
  }
  return headers
}

/**
 * Backend envelopes most responses as { data, error }. This helper unwraps it
 * and throws on error envelopes or non-2xx responses.
 */
export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers: await buildHeaders(opts.headers, opts.anonymous ?? false),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })

  const text = await res.text()
  const parsed: unknown = text ? safeJsonParse(text) : null

  if (!res.ok) {
    const errMsg =
      (parsed as { error?: { message?: string } | string } | null)?.error &&
      typeof (parsed as { error: { message?: string } }).error === 'object'
        ? (parsed as { error: { message?: string } }).error.message
        : typeof (parsed as { error?: string } | null)?.error === 'string'
          ? ((parsed as { error: string }).error)
          : res.statusText
    throw new ApiError(errMsg ?? res.statusText, res.status, parsed)
  }

  // Unwrap { data, error } envelope when present.
  if (
    parsed &&
    typeof parsed === 'object' &&
    'data' in (parsed as object) &&
    'error' in (parsed as object)
  ) {
    return (parsed as { data: T }).data
  }
  return parsed as T
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ───────────────────────── SSE streaming ─────────────────────────

export type SseEvent = {
  event?: string
  data: string
  id?: string
}

export type StreamOptions = {
  body?: Json
  headers?: Record<string, string>
  signal?: AbortSignal
  onEvent: (event: SseEvent) => void
}

export async function streamSse(path: string, opts: StreamOptions): Promise<void> {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: await buildHeaders(
      { ...opts.headers, Accept: 'text/event-stream' },
      false,
    ),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })

  if (!res.ok || !res.body) {
    throw new ApiError(`SSE connect failed: ${res.status}`, res.status)
  }

  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sepIndex: number
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex)
      buffer = buffer.slice(sepIndex + 2)
      const parsed = parseSseBlock(rawEvent)
      if (parsed) opts.onEvent(parsed)
    }
  }
}

function parseSseBlock(block: string): SseEvent | null {
  const lines = block.split('\n')
  let event: string | undefined
  let id: string | undefined
  const dataLines: string[] = []
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
    else if (field === 'id') id = value
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n'), id }
}
