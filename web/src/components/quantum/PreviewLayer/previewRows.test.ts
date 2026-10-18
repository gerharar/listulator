import { describe, expect, it } from 'vitest'
import type { PreviewItem } from '../../../lib/api.js'
import { groupPreviewRows } from '../../../lib/preview.js'
import { buildRowModel } from '../../../screens/list/rowModel.js'
import { PREVIEW_HEIGHTS, previewUnits } from './previewRows.js'

const entry = (title: string, group?: string): PreviewItem => ({ title, ...(group === undefined ? {} : { group }) })

describe('previewUnits: the Preview rows as units for the row model (Phase 26.2)', () => {
  it('a loose row is an item unit, a group head with its rows is a group unit', () => {
    const rows = groupPreviewRows([entry('a'), entry('b', 'S1'), entry('c', 'S1'), entry('d')])
    const units = previewUnits(rows)

    expect(units.map(({ unit, members }) => [unit.kind, unit.kind === 'group' ? unit.group.name : unit.item.id, members.map((member) => member.id)])).toEqual([
      ['item', 'i0', []],
      ['group', 'S1', ['i2', 'i3']],
      ['item', 'i4', []],
    ])
  })

  it('keys a row by its place in the rows, as the layer always did, and keeps the row data', () => {
    const rows = groupPreviewRows([entry('a', 'S1'), entry('b', 'S1')])
    const [unit] = previewUnits(rows)

    expect(unit!.unit.kind === 'group' && unit!.unit.group.id).toBe('g0')
    expect(unit!.members.map((member) => [member.id, member.item.title, member.grouped])).toEqual([
      ['i1', 'a', true],
      ['i2', 'b', true],
    ])
  })

  it('the same label in two separate runs is two units, and a fold by label shuts both', () => {
    const rows = groupPreviewRows([entry('a', 'S1'), entry('b'), entry('c', 'S1')])
    const units = previewUnits(rows)
    const model = buildRowModel(units, (name) => name === 'S1', PREVIEW_HEIGHTS)

    expect(units.map(({ unit }) => unit.kind)).toEqual(['group', 'item', 'group'])
    expect(model.total).toBe(3 * 40)
  })

  it('lays out at 40px a row, header and rows alike: the model is as tall as the rows are many', () => {
    const rows = groupPreviewRows([entry('a'), entry('b', 'S1'), entry('c', 'S1'), entry('d', 'S2'), entry('e', 'S2')])
    const open = buildRowModel(previewUnits(rows), () => false, PREVIEW_HEIGHTS)
    const folded = buildRowModel(previewUnits(rows), (name) => name === 'S1', PREVIEW_HEIGHTS)

    expect(open.total).toBe(rows.length * 40)
    expect(folded.total).toBe((rows.length - 2) * 40)
  })
})
