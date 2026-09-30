import type { FastifyReply } from 'fastify'

/**
 * Codes for errors the *user* is meant to read.
 *
 * The server names the situation; the web renders the sentence from its locale
 * (`web/src/locale/en.ts`). Prose lives in exactly one place, which is the
 * whole point — and a hosted, multi-tenant future cannot know the reader's
 * language at the point the error is raised anyway.
 *
 * This is only for errors with something to say to a person. Two other kinds
 * stay as prose on purpose:
 *
 * - **Operator errors** — a malformed strategy JSON, an upstream rate-limit.
 *   Those are diagnostics for whoever is self-hosting, and translating them
 *   would make debugging harder.
 * - **Framework errors** — schema validation, 404s. Fastify writes those, and
 *   the client falls back to `message` for exactly that reason.
 *
 * Adding a code means adding it to `errors` in the web locale too; anything
 * the locale does not recognise falls back to a generic line, so a mismatch
 * degrades rather than breaks.
 */
export type ApiErrorCode =
  | 'search.queryRequired'
  | 'search.unavailable'
  | 'search.unavailableOffline'
  | 'list.unknownCategory'
  | 'list.sourceEmpty'
  | 'list.fileInvalid'
  | 'list.fileSyntax'
  | 'list.fileNoItems'
  | 'list.fileMissingTitle'
  | 'list.fileItemMissingTitle'
  | 'list.fileItemNotesTooLong'
  | 'list.alreadyExists'
  | 'group.nameEmpty'
  | 'group.nameTaken'
  | 'group.notEmpty'
  | 'group.orderMismatch'
  | 'name.tooLong'
  | 'reset.unavailable'
  | 'refresh.handMadeList'
  | 'refresh.searchUnavailable'

export interface ApiErrorBody {
  code: ApiErrorCode
  /** Values the sentence needs. Never pre-formatted prose. */
  params?: Record<string, string | number>
}

/**
 * Sends a user-facing error as a code plus its values.
 *
 * No `message`: including English here would put the wording back in two
 * places, which is the thing this exists to stop.
 */
export function sendApiError(
  reply: FastifyReply,
  status: number,
  code: ApiErrorCode,
  params?: Record<string, string | number>,
): FastifyReply {
  return reply.code(status).send({ code, ...(params ? { params } : {}) } satisfies ApiErrorBody)
}
