import { describe, it, expect } from 'vitest'
import { hasPermission } from '../permissions'
import type { UserRole } from '@workspace/shared/types'

describe('hasPermission', () => {
  const roles: UserRole[] = ['owner', 'admin', 'editor', 'viewer']

  it('owner has permission for all roles', () => {
    for (const required of roles) {
      expect(hasPermission('owner', required)).toBe(true)
    }
  })

  it('admin has permission for admin, editor, viewer', () => {
    expect(hasPermission('admin', 'owner')).toBe(false)
    expect(hasPermission('admin', 'admin')).toBe(true)
    expect(hasPermission('admin', 'editor')).toBe(true)
    expect(hasPermission('admin', 'viewer')).toBe(true)
  })

  it('editor has permission for editor and viewer only', () => {
    expect(hasPermission('editor', 'owner')).toBe(false)
    expect(hasPermission('editor', 'admin')).toBe(false)
    expect(hasPermission('editor', 'editor')).toBe(true)
    expect(hasPermission('editor', 'viewer')).toBe(true)
  })

  it('viewer has permission for viewer only', () => {
    expect(hasPermission('viewer', 'owner')).toBe(false)
    expect(hasPermission('viewer', 'admin')).toBe(false)
    expect(hasPermission('viewer', 'editor')).toBe(false)
    expect(hasPermission('viewer', 'viewer')).toBe(true)
  })

  it('same role always has permission', () => {
    for (const role of roles) {
      expect(hasPermission(role, role)).toBe(true)
    }
  })

  it('hierarchy is strictly ordered: owner > admin > editor > viewer', () => {
    expect(hasPermission('owner', 'admin')).toBe(true)
    expect(hasPermission('admin', 'owner')).toBe(false)

    expect(hasPermission('admin', 'editor')).toBe(true)
    expect(hasPermission('editor', 'admin')).toBe(false)

    expect(hasPermission('editor', 'viewer')).toBe(true)
    expect(hasPermission('viewer', 'editor')).toBe(false)
  })
})
