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
      'When you have no idea if new stuff is coming our or not',
      'New stuff is coming out',
      'Nothing new will come out',
    ])
  })
})
