import { describe, expect, it } from 'vitest'
import { createTestApp } from './testing/harness.js'

describe('GET /health', () => {
  it('reports ok', async () => {
    const { app, cleanup } = createTestApp()

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })

    await cleanup()
  })
})
