// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TagChoice } from './TagChoice.js'
import type { TagField } from './tagFields.js'

afterEach(cleanup)

const field: Extract<TagField, { kind: 'choice' }> = {
  kind: 'choice',
  label: 'Type',
  values: [{ tag: 'Album', label: 'Album' }],
  flags: [],
  keepOrder: true,
  main: { key: 'type', label: 'Type' },
  flagDefs: [],
}

/** BL-152 / SR-119: the pick can be a tag a list file wrote; one named like an inherited object member is shown as written. */
describe('TagChoice with a hostile tag', () => {
  it.each(['__proto__', 'constructor', 'toString'])('shows %s as the pick instead of failing', (tag) => {
    const { container } = render(<TagChoice field={field} current={{ main: tag, flags: [] }} onChange={vi.fn()} />)

    // Exactly the tag: a function or object found on the way would read "function toString() { [native code] }".
    expect(container.querySelector('.q-tagchoice-value')!.textContent).toBe(tag)
  })
})
