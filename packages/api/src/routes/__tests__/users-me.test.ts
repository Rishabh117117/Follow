import { describe, it, expect, beforeAll } from 'vitest'
import { getTestApp, makeRequest } from '../../__tests__/helpers/test-setup'

let app: Awaited<ReturnType<typeof getTestApp>>

beforeAll(async () => {
  app = await getTestApp()
}, 30_000)

describe('/api/users/me — workspace header handling', () => {
  it('without x-workspace-id → clean 400 (was a 500 UNDEFINED_VALUE)', async () => {
    const res = await makeRequest(app, 'GET', '/api/users/me', undefined, {
      'x-workspace-id': '',
    })
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('BAD_REQUEST')
  })

  it('with x-workspace-id → 200 user payload', async () => {
    const res = await makeRequest(app, 'GET', '/api/users/me')
    expect(res.status).toBe(200)
    expect(res.json.error).toBeNull()
    expect(res.json.data.user.id).toBeTruthy()
  })
})
