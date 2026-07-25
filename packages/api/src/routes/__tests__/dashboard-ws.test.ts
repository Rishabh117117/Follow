import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'dashboard.html'),
  'utf-8'
)

const serverCode = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'dashboard-server.ts'),
  'utf-8'
)

describe('dashboard WebSocket + DC-2 tabs', () => {
  it('dashboard-server.ts creates WebSocketServer on /ws', () => {
    expect(serverCode).toContain('WebSocketServer')
    expect(serverCode).toContain("path: '/ws'")
  })

  it('dashboard-server.ts broadcasts traffic events', () => {
    expect(serverCode).toContain('broadcast')
    expect(serverCode).toContain("type: 'log'")
  })

  it('dashboard-server.ts broadcasts log events with correct source', () => {
    expect(serverCode).toContain("source: 'api'")
    expect(serverCode).toContain("source, line")
  })

  it('system tab renders cost breakdown from real health data (WIRE-1)', () => {
    expect(html).toContain('SystemTab')
    expect(html).toContain("Today's Cost")
    expect(html).toContain('LLM Cost by Model')
    // WIRE-1: costs now come from data.costs.byModel, not hardcoded list
    expect(html).toContain('data?.costs?.today')
    expect(html).toContain('data?.costs?.byModel')
  })

  it('traffic tab renders request table', () => {
    expect(html).toContain('TrafficTab')
    expect(html).toContain('traffic-table')
    expect(html).toContain('Live API Traffic')
    expect(html).toContain("ws://localhost:4000/ws")
  })
})
