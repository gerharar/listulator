import { describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/harness.js'

describe('GET /api/me', () => {
  it('returns the default local user with no login step', async () => {
    const { app, cleanup } = createTestApp()

    const response = await app.inject({ method: 'GET', url: '/api/me' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      isDefaultLocalUser: true,
    })

    await cleanup()
  })

  it('returns the same user across requests', async () => {
    const { app, cleanup } = createTestApp()

    const first = await app.inject({ method: 'GET', url: '/api/me' })
    const second = await app.inject({ method: 'GET', url: '/api/me' })

    expect(first.json().id).toBe(second.json().id)

    await cleanup()
  })

  it('reuses the existing user when the server restarts on the same database', async () => {
    const original = createTestApp()
    const firstBootId = (await original.app.inject({ method: 'GET', url: '/api/me' })).json().id
    await original.app.close()

    // Same file, fresh app — bootstrap must find the user, not create a second.
    const restarted = createTestApp({ databasePath: original.databasePath })
    const secondBootId = (await restarted.app.inject({ method: 'GET', url: '/api/me' })).json().id

    expect(secondBootId).toBe(firstBootId)

    await restarted.cleanup()
    await original.cleanup()
  })

  it('refuses to serve data when multi-user mode is requested but unimplemented', async () => {
    const { app, cleanup } = createTestApp({ singleUserMode: false })

    const response = await app.inject({ method: 'GET', url: '/api/me' })

    expect(response.statusCode).toBe(501)

    await cleanup()
  })

  it('leaves /health outside the auth scope', async () => {
    const { app, cleanup } = createTestApp({ singleUserMode: false })

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })

    await cleanup()
  })
})
