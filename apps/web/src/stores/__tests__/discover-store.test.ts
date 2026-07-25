import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDiscoverStore } from '../discover-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

describe('useDiscoverStore', () => {
  beforeEach(() => {
    useDiscoverStore.getState().reset()
  })

  it('defaults to topics_only privacy floor', () => {
    expect(useDiscoverStore.getState().privacyFloor).toBe('topics_only')
  })

  it('setSource updates source and preserves privacy floor', () => {
    useDiscoverStore.getState().setSource('idx-1')
    expect(useDiscoverStore.getState().sourceIndexId).toBe('idx-1')
    expect(useDiscoverStore.getState().privacyFloor).toBe('topics_only')
  })

  it('setPrivacyFloor cycles through the 3 levels', () => {
    useDiscoverStore.getState().setPrivacyFloor('fingerprint_only')
    expect(useDiscoverStore.getState().privacyFloor).toBe('fingerprint_only')
    useDiscoverStore.getState().setPrivacyFloor('full_signature')
    expect(useDiscoverStore.getState().privacyFloor).toBe('full_signature')
  })

  it('runDiscover without a source sets an error and does not run', async () => {
    await useDiscoverStore.getState().runDiscover()
    expect(useDiscoverStore.getState().error).toMatch(/Pick a source/)
    expect(useDiscoverStore.getState().suggestions).toBeNull()
  })

  it('reset clears everything', () => {
    useDiscoverStore.getState().setSource('idx-1')
    useDiscoverStore.getState().setPrivacyFloor('full_signature')
    useDiscoverStore.setState({ error: 'err' })
    useDiscoverStore.getState().reset()
    expect(useDiscoverStore.getState().sourceIndexId).toBeNull()
    expect(useDiscoverStore.getState().privacyFloor).toBe('topics_only')
    expect(useDiscoverStore.getState().error).toBeNull()
  })
})
