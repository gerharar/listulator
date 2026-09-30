import { NAME_MAX_LENGTH } from '../../../server/src/catalog/limits.js'
import { errorMessage } from '../locale/index.js'
import { ApiError } from './api.js'

/**
 * The desktop backend has no request schemas like the server's, so the 255-character limit on the
 * names people type (a list's title, an item's title, a group's name) is checked here, at the
 * entry points that take them. Blank, `null` and missing values are left to their own checks.
 */
export function checkNameLengths(fields: Record<string, string | null | undefined>): void {
  for (const value of Object.values(fields)) {
    if (typeof value === 'string' && value.length > NAME_MAX_LENGTH) {
      throw new ApiError(errorMessage('name.tooLong', { max: NAME_MAX_LENGTH }) ?? 'name.tooLong', 400, 'name.tooLong')
    }
  }
}
