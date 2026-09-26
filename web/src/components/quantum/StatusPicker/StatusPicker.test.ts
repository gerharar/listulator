import { describe, expect, it } from 'vitest'
import { statusPickerOptions } from './StatusPicker.js'

describe('statusPickerOptions', () => {
  it('is Not known, Ongoing, Complete, in exactly that order, every time', () => {
    expect(statusPickerOptions().map((option) => option.label)).toEqual([
      'Not known',
      'Ongoing',
      'Complete',
    ])
    expect(statusPickerOptions().map((option) => option.value)).toEqual([null, 'ongoing', 'complete'])
  })

  it('carries the exact consequence sentence for each option', () => {
    expect(statusPickerOptions().map((option) => option.note)).toEqual([
      'Leave blank if you do not know.',
      'More may appear upstream.',
      'Finished — it will not gain items.',
    ])
  })
})
