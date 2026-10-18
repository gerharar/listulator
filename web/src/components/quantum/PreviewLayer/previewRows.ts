import type { PreviewItem } from '../../../lib/api.js'
import type { PreviewRowData } from '../../../lib/preview.js'
import type { RowHeights, ShownUnit } from '../../../screens/list/rowModel.js'

/** The Preview's rows are 40px, a group head as well (`.q-preview-row`, `.q-preview-group`); checked against the real page in the e2e. */
export const PREVIEW_HEIGHTS: RowHeights = { itemHeight: 40, groupHeight: 40 }

/** A Preview row for the row model: keyed by its place in the rows, so a row keeps its key whatever is drawn around it. */
export interface PreviewEntry {
  id: string
  item: PreviewItem
  grouped: boolean
}

/** A group's head: its label is what folds (the fold is by label, so a label that comes twice folds both). */
export type PreviewUnit =
  | { kind: 'item'; item: PreviewEntry }
  | { kind: 'group'; group: { id: string; name: string; count: number } }

/** The rows (heads and items, in arrival order) as units: a loose row, or a head with the rows that follow it. */
export function previewUnits(rows: readonly PreviewRowData[]): ShownUnit<PreviewEntry, PreviewUnit>[] {
  const units: ShownUnit<PreviewEntry, PreviewUnit>[] = []
  let open: ShownUnit<PreviewEntry, PreviewUnit> | undefined

  rows.forEach((row, index) => {
    if (row.kind === 'group') {
      open = { unit: { kind: 'group', group: { id: `g${index}`, name: row.label, count: row.count } }, members: [] }
      units.push(open)

      return
    }

    const entry: PreviewEntry = { id: `i${index}`, item: row.item, grouped: row.grouped }
    if (row.grouped && open) open.members.push(entry)
    else units.push({ unit: { kind: 'item', item: entry }, members: [] })
  })

  return units
}
