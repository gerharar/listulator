import { describe, expect, it } from 'vitest'
import { createTestApp } from './testing/harness.js'

/** What the server tells the app about itself, apart from any user (Phase 25.7: the list virtualization switch). */
describe('GET /api/server-settings', () => {
  it('says `auto` by default', async () => {
    const { app, cleanup } = createTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/server-settings' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ listVirtualization: 'auto' })
    await cleanup()
  })

  it('says `off` when the server is set to off', async () => {
    const { app, cleanup } = createTestApp({ listVirtualization: 'off' })

    const response = await app.inject({ method: 'GET', url: '/api/server-settings' })

    expect(response.json()).toEqual({ listVirtualization: 'off' })
    await cleanup()
  })
})
