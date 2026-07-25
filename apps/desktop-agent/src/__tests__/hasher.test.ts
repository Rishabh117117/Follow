import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { hashFile, hashString, hashBuffer } from '../hasher.js'

const TEST_DIR = join(tmpdir(), 'follow-agent-test-hasher')

function setup() {
  mkdirSync(TEST_DIR, { recursive: true })
}

function writeTemp(name: string, content: string): string {
  const p = join(TEST_DIR, name)
  writeFileSync(p, content)
  return p
}

describe('Content Hasher', () => {
  beforeAll(() => setup())
  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }))

  it('produces consistent SHA-256 for same content', async () => {
    const p = writeTemp('a.txt', 'hello world')
    const hash1 = await hashFile(p)
    const hash2 = await hashFile(p)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex = 64 chars
  })

  it('produces different hashes for different content', async () => {
    const p1 = writeTemp('b1.txt', 'hello')
    const p2 = writeTemp('b2.txt', 'world')
    const hash1 = await hashFile(p1)
    const hash2 = await hashFile(p2)
    expect(hash1).not.toBe(hash2)
  })

  it('hashString produces valid SHA-256', () => {
    const hash = hashString('test content')
    expect(hash).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true)
  })

  it('hashBuffer produces valid SHA-256', () => {
    const hash = hashBuffer(Buffer.from('test content'))
    expect(hash).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true)
  })

  it('hashString is consistent', () => {
    const h1 = hashString('same content')
    const h2 = hashString('same content')
    expect(h1).toBe(h2)
  })

})
