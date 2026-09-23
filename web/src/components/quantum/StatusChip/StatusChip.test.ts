import { describe, expect, it } from 'vitest'
import { statusChipData } from './StatusChip.js'

describe('statusChipData', () => {
  it('is Complete, gold-styled, for a closed run', () => {
    expect(statusChipData('complete')).toEqual({
      value: 'complete',
      label: 'Complete',
      note: 'Finished — it will not gain items.',
      tip: 'Complete — Finished — it will not gain items.',
    })
  })

  it('is Ongoing, teal-styled, for a run still airing', () => {
    expect(statusChipData('ongoing')).toEqual({
      value: 'ongoing',
      label: 'Ongoing',
      note: 'More may appear upstream.',
      tip: 'Ongoing — More may appear upstream.',
    })
  })

  it('is null when nobody knows — there is no "Unknown" chip', () => {
    expect(statusChipData(null)).toBeNull()
  })
})
