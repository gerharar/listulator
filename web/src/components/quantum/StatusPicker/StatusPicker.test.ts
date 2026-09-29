import { describe, expect, it } from 'vitest'
import { statusPickerOptions } from './StatusPicker.js'

describe('statusPickerOptions', () => {
  it('is Not known, Ongoing, Complete, in exactly that order, every time', () => {
    expect(statusPickerOptions().map((option) => option.label)).toEqual([
      'Schrödinger',
      'Ongoing',
      'Complete',
    ])
    expect(statusPickerOptions().map((option) => option.value)).toEqual([null, 'ongoing', 'complete'])
  })

  it('carries the exact consequence sentence for each option', () => {
    expect(statusPickerOptions().map((option) => option.note)).toEqual([
      'You have no idea whether the media behind this list will get new stuff or not',
      'This list is not over yet (new stuff is coming out)',
      'This list is finished (nothing new will come out)',
    ])
  })
})
