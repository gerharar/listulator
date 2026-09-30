import { describe, expect, it } from 'vitest'
import { ApiError } from './api.js'
import { checkNameLengths } from './nameLimit.js'

describe('checkNameLengths (the desktop backend’s 255-character limit on names)', () => {
  it('lets a name of exactly 255 through, and blanks, nulls and missing fields', () => {
    expect(() => checkNameLengths({ title: 'x'.repeat(255), group: null, name: undefined, other: '' })).not.toThrow()
  })

  it('refuses a name of 256 with a 400 that names the limit, in the app’s words', () => {
    try {
      checkNameLengths({ title: 'ok', group: 'g'.repeat(256) })
      expect.unreachable()
    } catch (cause) {
      expect(cause).toBeInstanceOf(ApiError)
      expect(cause).toMatchObject({ status: 400, code: 'name.tooLong' })
      expect((cause as ApiError).message).toMatch(/255/)
    }
  })
})
