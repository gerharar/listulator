import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { hostNameOf, isAllowedHost } from './allowedHosts.js'

describe('hostNameOf', () => {
  it('drops the port, lowercases, and keeps an IPv6 address whole', () => {
    expect(hostNameOf('LocalHost:3001')).toBe('localhost')
    expect(hostNameOf('127.0.0.1')).toBe('127.0.0.1')
    expect(hostNameOf('[::1]:3001')).toBe('::1')
    expect(hostNameOf('[::1]')).toBe('::1')
  })

  it('has nothing to give for a missing or empty header', () => {
    expect(hostNameOf(undefined)).toBeUndefined()
    expect(hostNameOf('')).toBeUndefined()
  })
})

describe('isAllowedHost', () => {
  it('answers this machine by name and by loopback address, on any port', () => {
    for (const host of ['localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'localhost']) {
      expect(isAllowedHost(host, { bindHost: '127.0.0.1', extra: [] })).toBe(true)
    }
  })

  it('refuses any other name: a page that rebinds its own domain to 127.0.0.1 still sends that domain', () => {
    expect(isAllowedHost('evil.example:3001', { bindHost: '127.0.0.1', extra: [] })).toBe(false)
    expect(isAllowedHost('127.0.0.1.evil.example', { bindHost: '127.0.0.1', extra: [] })).toBe(false)
    expect(isAllowedHost(undefined, { bindHost: '127.0.0.1', extra: [] })).toBe(false)
  })

  it('answers the address it was told to bind, and the names given in ALLOWED_HOSTS', () => {
    expect(isAllowedHost('192.168.1.20:3001', { bindHost: '192.168.1.20', extra: [] })).toBe(true)
    expect(isAllowedHost('nas.local:3001', { bindHost: '0.0.0.0', extra: ['nas.local'] })).toBe(true)
  })

  it('does not take a wildcard bind (0.0.0.0, ::) for a name anyone may use', () => {
    expect(isAllowedHost('0.0.0.0:3001', { bindHost: '0.0.0.0', extra: [] })).toBe(false)
    expect(isAllowedHost('192.168.1.20:3001', { bindHost: '0.0.0.0', extra: [] })).toBe(false)
    expect(isAllowedHost('[::]:3001', { bindHost: '::', extra: [] })).toBe(false)
  })
})

describe('the server refuses a request addressed to a name it does not answer to', () => {
  let harness: TestApp | undefined

  afterEach(async () => {
    await harness?.cleanup()
  })

  it('answers the API on localhost and refuses it under another name, with nothing read', async () => {
    harness = createTestApp()

    const local = await harness.app.inject({ method: 'GET', url: '/api/lists', headers: { host: 'localhost:3001' } })
    const rebound = await harness.app.inject({ method: 'GET', url: '/api/lists', headers: { host: 'evil.example:3001' } })

    expect(local.statusCode).toBe(200)
    expect(rebound.statusCode).toBe(403)
    expect(rebound.json()).toEqual({ error: 'Forbidden', message: expect.stringContaining('ALLOWED_HOSTS') })
  })

  it('refuses a write under another name before it touches anything', async () => {
    harness = createTestApp()

    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: { host: 'evil.example' },
      payload: { title: 'Planted', mediaType: 'movie' },
    })

    expect(created.statusCode).toBe(403)
    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()).toEqual([])
  })

  it('answers a name given in ALLOWED_HOSTS', async () => {
    harness = createTestApp({ allowedHosts: ['nas.local'] })

    const response = await harness.app.inject({ method: 'GET', url: '/api/lists', headers: { host: 'nas.local:3001' } })

    expect(response.statusCode).toBe(200)
  })

  it('leaves /health open, as it is outside /api and says nothing', async () => {
    harness = createTestApp()

    const response = await harness.app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example' } })

    expect(response.statusCode).toBe(200)
  })
})
