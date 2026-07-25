'use client'

import { useState } from 'react'

export interface ToolCallEntry {
  name: string
  args?: Record<string, unknown>
  result?: unknown
  durationMs?: number
  startedAt?: string
}

export interface ReasoningMetadata {
  thinking?: string
  agentIntent?: string
  planSteps?: string[]
  toolCalls?: ToolCallEntry[]
  sources?: Array<{ label?: string; type?: string; id?: string } | string>
  model?: string
  tokensIn?: number
  tokensOut?: number
  latencyMs?: number
  artifactIds?: string[]
  // Prose-aligned aliases older rows may carry. The panel reads from them
  // as a fallback so data saved before the save-path normalization still
  // renders.
  chain_of_thought?: string
  tool_invocations?: ToolCallEntry[]
  citations?: Array<{ label?: string; type?: string; id?: string } | string>
  plan?: string[]
  intent?: string
  model_id?: string
  input_tokens?: number
  output_tokens?: number
  latency?: number
}

function normalizeSource(
  s: { label?: string; type?: string; id?: string } | string
): { label: string; type: string; id?: string } | null {
  if (typeof s === 'string') {
    const trimmed = s.trim()
    if (!trimmed) return null
    const isUrl = /^https?:\/\//i.test(trimmed)
    return { label: trimmed, type: isUrl ? 'url' : 'text' }
  }
  const label =
    s.label ||
    (s as Record<string, unknown>)['title'] as string ||
    (s as Record<string, unknown>)['name'] as string ||
    (s as Record<string, unknown>)['url'] as string ||
    ''
  if (!label) return null
  const type =
    s.type ||
    ((s as Record<string, unknown>)['kind'] as string) ||
    (typeof (s as Record<string, unknown>)['url'] === 'string' ? 'url' : 'text')
  return s.id ? { label, type, id: s.id } : { label, type }
}

/**
 * Sprint MCP-3: collapsible reasoning trail. Only renders when the
 * assistant message has at least one reasoning field populated.
 */
export function ReasoningPanel({ metadata }: { metadata: ReasoningMetadata }) {
  const [open, setOpen] = useState(false)

  // Resolve canonical + alias field names so older rows (and clients that
  // used the prose wording from the schema) still render.
  const thinking = metadata.thinking ?? metadata.chain_of_thought
  const agentIntent = metadata.agentIntent ?? metadata.intent
  const planSteps = metadata.planSteps ?? metadata.plan ?? []
  const toolCalls = metadata.toolCalls ?? metadata.tool_invocations ?? []
  const rawSources = metadata.sources ?? metadata.citations ?? []
  const sources = rawSources
    .map(normalizeSource)
    .filter((s): s is { label: string; type: string; id?: string } => s !== null)
  const model = metadata.model ?? metadata.model_id
  const tokensIn = metadata.tokensIn ?? metadata.input_tokens
  const tokensOut = metadata.tokensOut ?? metadata.output_tokens

  const hasContent =
    !!thinking ||
    !!agentIntent ||
    planSteps.length > 0 ||
    toolCalls.length > 0 ||
    sources.length > 0
  if (!hasContent) return null
  return (
    <div
      data-testid="reasoning-panel"
      style={{
        marginTop: 6,
        fontSize: 11,
        border: '1px solid var(--n150, #e5e2de)',
        borderRadius: 6,
        background: 'var(--n50, #fafafa)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="reasoning-toggle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--n600, #6b6358)',
          fontFamily: 'monospace',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Reasoning trail</span>
        {model && (
          <span style={{ color: 'var(--n400, #9c968d)' }}>· {model}</span>
        )}
        {typeof tokensIn === 'number' && typeof tokensOut === 'number' && (
          <span style={{ color: 'var(--n400, #9c968d)' }}>
            · {tokensIn}↓ {tokensOut}↑
          </span>
        )}
      </button>
      {open && (
        <div style={{ padding: '4px 12px 12px 12px', color: 'var(--n700, #4d473c)' }}>
          {agentIntent && (
            <div style={{ marginTop: 6 }}>
              <strong>Intent:</strong> {agentIntent}
            </div>
          )}
          {thinking && (
            <div style={{ marginTop: 6 }}>
              <strong>Thinking:</strong>
              <pre
                style={{
                  marginTop: 3,
                  padding: 8,
                  background: '#fff',
                  border: '1px solid var(--n150, #e5e2de)',
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {thinking}
              </pre>
            </div>
          )}
          {planSteps.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Plan:</strong>
              <ol style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {planSteps.map((s, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {toolCalls.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Tool calls:</strong>
              <ul
                style={{
                  margin: '4px 0 0 0',
                  padding: 0,
                  listStyle: 'none',
                  fontFamily: 'monospace',
                  fontSize: 10,
                }}
              >
                {toolCalls.map((t, i) => (
                  <li
                    key={i}
                    style={{
                      padding: '4px 6px',
                      background: '#fff',
                      border: '1px solid var(--n150, #e5e2de)',
                      borderRadius: 4,
                      marginBottom: 3,
                    }}
                  >
                    <span style={{ color: '#6C63FF', fontWeight: 500 }}>{t.name}</span>
                    {typeof t.durationMs === 'number' && (
                      <span style={{ color: 'var(--n400, #9c968d)', marginLeft: 6 }}>
                        · {t.durationMs}ms
                      </span>
                    )}
                    {t.args && Object.keys(t.args).length > 0 && (
                      <div style={{ color: 'var(--n500, #807a70)', marginTop: 2 }}>
                        {JSON.stringify(t.args)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sources.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Sources:</strong>{' '}
              {sources
                .map((s) => (s.type && s.type !== 'text' ? `${s.label} (${s.type})` : s.label))
                .join(', ')}
            </div>
          )}
          {metadata.artifactIds && metadata.artifactIds.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Artifacts:</strong>{' '}
              <span style={{ fontFamily: 'monospace', color: 'var(--n500, #807a70)' }}>
                {metadata.artifactIds.map((a) => a.slice(0, 8)).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
