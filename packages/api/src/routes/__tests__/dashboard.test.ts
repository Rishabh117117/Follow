import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(
  resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'dashboard.html'),
  'utf-8'
)

describe('dashboard.html (DC-1)', () => {
  it('contains all 7 tab labels', () => {
    const tabs = ['Overview', 'MCP', 'Pipeline', 'Users', 'System', 'Traffic', 'Logs']
    for (const tab of tabs) {
      expect(html).toContain(tab)
    }
  })

  it('loads React from CDN', () => {
    expect(html).toContain('react.production.min.js')
    expect(html).toContain('react-dom')
  })

  it('stat card component renders label and value', () => {
    // StatCard component is defined and used
    expect(html).toContain('function StatCard')
    expect(html).toContain('className="stat-card"')
    expect(html).toContain('className="label"')
    expect(html).toContain('className="value"')
  })

  it('service row renders status dot and name', () => {
    expect(html).toContain('function ServiceRow')
    expect(html).toContain('className="name"')
    expect(html).toContain('dotClass(')
  })

  it('tool list renders tools from health data', () => {
    expect(html).toContain('MCP Tools')
    expect(html).toContain('tool-name')
    expect(html).toContain('tool-row')
    expect(html).toContain('toolNames')
  })

  it('users table is wired to the live users endpoint', () => {
    // The hardcoded mock users were replaced by a live fetch — assert the
    // table exists and pulls from /api/users/stats instead.
    expect(html).toContain('users-table')
    expect(html).toContain('/api/users/stats')
  })
})
