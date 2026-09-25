import type { PickedStatus } from '../../components/quantum/StatusPicker/StatusPicker.js'

/** The list's own fields that its Edit popover changes. */
export interface ListFields {
  title: string
  description: string | null
  status: PickedStatus
}

/** What the popover holds while it is open, as typed. */
export interface ListDraft {
  title: string
  description: string
  status: PickedStatus
}

export interface ListPatch {
  title?: string
  description?: string | null
  status?: PickedStatus
}

/**
 * What saving the draft would change: only the fields that differ, or `null`
 * when nothing does *or* the draft cannot be saved (a blank title). An emptied
 * description is `null` — the way to remove one — and so is "Not known".
 */
export function buildListPatch(list: ListFields, draft: ListDraft): ListPatch | null {
  const title = draft.title.trim()
  if (title === '') return null

  const description = draft.description.trim() === '' ? null : draft.description.trim()
  const patch: ListPatch = {}

  if (title !== list.title) patch.title = title
  if (description !== (list.description?.trim() || null)) patch.description = description
  if (draft.status !== list.status) patch.status = draft.status

  return Object.keys(patch).length > 0 ? patch : null
}

/** The patch that undoes `patch` on `list`: each changed field back to what it was. */
export function invertListPatch(list: ListFields, patch: ListPatch): ListPatch {
  const back: ListPatch = {}

  if (patch.title !== undefined) back.title = list.title
  if (patch.description !== undefined) back.description = list.description
  if (patch.status !== undefined) back.status = list.status

  return back
}
