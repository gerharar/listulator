import { describe, expect, it } from 'vitest'
import { statusChipData } from './StatusChip.js'

describe('statusChipData', () => {
  it('is Complete, gold-styled, for a closed run', () => {
    expect(statusChipData('complete')).toEqual({
      value: 'complete',
      label: 'Complete',
      note: 'This list is finished (nothing new will come out)',
      tip: 'Complete — This list is finished (nothing new will come out)',
    })
  })

  it('is Ongoing, teal-styled, for a run still airing', () => {
    expect(statusChipData('ongoing')).toEqual({
      value: 'ongoing',
      label: 'Ongoing',
      note: 'This list is not over yet (new stuff is coming out)',
      tip: 'Ongoing — This list is not over yet (new stuff is coming out)',
    })
  })

  it('is null when nobody knows — there is no "Unknown" chip', () => {
    expect(statusChipData(null)).toBeNull()
  })
})
