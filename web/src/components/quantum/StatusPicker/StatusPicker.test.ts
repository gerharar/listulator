import { describe, expect, it } from 'vitest'
import { STATUS_PICKER_OPTIONS } from './StatusPicker.js'

describe('STATUS_PICKER_OPTIONS', () => {
  it('is Not known, Ongoing, Complete, in exactly that order, every time', () => {
    expect(STATUS_PICKER_OPTIONS.map((option) => option.label)).toEqual([
      'Not known',
      'Ongoing',
      'Complete',
    ])
    expect(STATUS_PICKER_OPTIONS.map((option) => option.value)).toEqual([null, 'ongoing', 'complete'])
  })

  it('carries the exact consequence sentence for each option', () => {
    expect(STATUS_PICKER_OPTIONS.map((option) => option.note)).toEqual([
      'Leave blank if you do not know.',
      'More may appear upstream.',
      'Finished — it will not gain items.',
    ])
  })
})
