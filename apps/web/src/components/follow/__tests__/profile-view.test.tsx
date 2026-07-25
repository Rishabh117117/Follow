import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'memory', 'profile-view.tsx'), 'utf-8')

/**
 * After V41-CONFIG-1, ProfileView is a thin redirect shim — the governance
 * surface it used to duplicate now lives in ConfigHub. The original WIRE-1
 * source-inspection assertions no longer apply and would fail against the
 * shim by design.
 *
 * These tests assert the shim's two promises: it redirects to the config
 * route, and it does not reintroduce the hardcoded user data the WIRE-1
 * sprint removed.
 */
describe('ProfileView (V41-CONFIG-1 redirect shim)', () => {
  it('is marked DEPRECATED in a comment', () => {
    expect(source).toMatch(/DEPRECATED in V41-CONFIG-1/)
  })

  it('redirects to the settings profile page', () => {
    expect(source).toContain('/settings/profile')
    expect(source).toContain('router.replace')
  })

  it('imports useRouter from next/navigation', () => {
    expect(source).toContain("from 'next/navigation'")
    expect(source).toContain('useRouter')
  })

  it('does not reintroduce the WIRE-1-removed hardcoded user data', () => {
    expect(source).not.toContain('Rishabh Salian')
    expect(source).not.toContain('salir225@newschool.edu')
    expect(source).not.toContain('CONNECTED_APPS = [')
  })

  it('renders a visible placeholder while redirect resolves', () => {
    expect(source).toContain('data-testid="profile-view-redirect"')
    expect(source).toMatch(/Redirecting to Settings/)
  })
})
