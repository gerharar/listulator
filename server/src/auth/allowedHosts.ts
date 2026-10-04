import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

/**
 * The names the server answers to (review 2026-10-04). It has no login in single-user mode, so any page open in
 * the owner's browser could read and change every list through DNS rebinding: its own domain is pointed at
 * 127.0.0.1, the browser then treats the server as same-origin, and the one thing it cannot change is the `Host`
 * header, which still carries that domain. Refusing every name but this machine's stops it.
 *
 * Not a login: with `HOST=0.0.0.0` anyone on the network who uses an allowed name still gets in.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

/** A bind address that means "every interface", never a name a request can be addressed to. */
const WILDCARD = new Set(['0.0.0.0', '::'])

/** The host name of a `Host` header: no port, lowercase, an IPv6 address without its brackets. */
export function hostNameOf(header: string | undefined): string | undefined {
  const value = header?.trim().toLowerCase()
  if (!value) return undefined

  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 0 ? value.slice(1, end) : undefined
  }

  return value.split(':')[0] || undefined
}

export interface AllowedHosts {
  /** The configured `HOST`: binding a specific address means requests to it are expected. */
  bindHost: string
  /** `ALLOWED_HOSTS`, already lowercase. */
  extra: readonly string[]
}

export function isAllowedHost(header: string | undefined, { bindHost, extra }: AllowedHosts): boolean {
  const name = hostNameOf(header)
  if (!name) return false

  if (LOOPBACK.has(name) || extra.includes(name)) return true

  const bound = hostNameOf(bindHost)
  return bound !== undefined && !WILDCARD.has(bound) && bound === name
}

/** Refuses a request to any other name with a 403 before routing, so nothing is read or written. */
const plugin: FastifyPluginAsync<AllowedHosts> = async (app, allowed) => {
  app.addHook('onRequest', async (request, reply) => {
    if (isAllowedHost(request.headers.host, allowed)) return

    return reply.code(403).send({
      error: 'Forbidden',
      message: `This server does not answer to "${hostNameOf(request.headers.host) ?? ''}". Add the name to ALLOWED_HOSTS in .env to reach it that way.`,
    })
  })
}

/** `fastify-plugin` so the hook covers the scope it is registered on (the /api scope), as `currentUserPlugin` does. */
export const allowedHostsPlugin = fp(plugin, { name: 'allowed-hosts' })
