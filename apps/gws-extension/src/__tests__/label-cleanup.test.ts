import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(__dirname, '..', '..')

function walk(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
      result.push(...walk(p))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      result.push(p)
    }
  }
  return result
}

describe('Extension Label Cleanup (WIRE-1)', () => {
  it('no user-facing strings contain "Smart Document" or "Smart Doc"', () => {
    const srcDir = resolve(extensionRoot, 'src')
    const files = walk(srcDir)
    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      if (/Smart Document|Smart Doc(?!umenting)/.test(content)) {
        offenders.push(file.replace(extensionRoot + '/', '').replace(extensionRoot + '\\', ''))
      }
    }
    // Test files are allowed to reference them for validation
    const offendersExcludingTests = offenders.filter((f) => !f.includes('__tests__'))
    expect(offendersExcludingTests).toEqual([])
  })

  it('no user-facing strings contain "Follow Doc"', () => {
    const srcDir = resolve(extensionRoot, 'src')
    const files = walk(srcDir)
    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      if (/Follow Doc/.test(content)) {
        offenders.push(file.replace(extensionRoot + '/', '').replace(extensionRoot + '\\', ''))
      }
    }
    const offendersExcludingTests = offenders.filter((f) => !f.includes('__tests__'))
    expect(offendersExcludingTests).toEqual([])
  })

  it('manifest.json name is "Follow"', () => {
    const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'manifest.json'), 'utf-8'))
    expect(manifest.name).toBe('Follow')
  })

  it('manifest.json description does not contain "Smart Document"', () => {
    const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'manifest.json'), 'utf-8'))
    expect(manifest.description).not.toContain('Smart Document')
  })

  it('ActivationPopup uses "Activate Document" not "Activate Smart Document"', () => {
    const file = resolve(
      extensionRoot,
      'src',
      'components',
      'smart-doc',
      'ActivationPopup.tsx'
    )
    const content = readFileSync(file, 'utf-8')
    expect(content).toContain('Activate Document')
    expect(content).not.toContain('Activate Smart Document')
  })

  it('SmartDocBadge uses "Document" text', () => {
    const file = resolve(extensionRoot, 'src', 'components', 'smart-doc', 'SmartDocBadge.tsx')
    const content = readFileSync(file, 'utf-8')
    expect(content).toContain("'Document'")
    expect(content).not.toContain("'Smart Doc'")
  })
})
