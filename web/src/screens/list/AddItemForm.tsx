import './AddItemForm.css'
import { useRef, useState, type FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { ErrorStrip } from '../../components/quantum/ErrorStrip/ErrorStrip.js'
import { Field } from '../../components/quantum/Field/Field.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { PlatformPicker } from '../../components/quantum/PlatformPanel/PlatformPanel.js'
import { platformDraft } from '../../components/quantum/PlatformPanel/platformPicks.js'
import { GroupCombobox } from './GroupCombobox.js'
import { TagChoice } from './TagChoice.js'
import { choiceOf, type TagField } from './tagFields.js'

/**
 * Whole minutes as typed. Blank is `null` — use the category's default and
 * mark it estimated — and anything that is not a whole number is `NaN`.
 */
export function parseMinutes(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

export interface NewItemInput {
  title: string
  /** `null`: the category's default, estimated. */
  minutes: number | null
  /** Empty: no group. A name the list lacks creates the group. */
  group: string
  /** The new item's tags (U5), only where the category has a tag field. */
  tags?: string[]
}

export interface AddItemFormProps {
  /** The list's groups, in order. */
  groups: readonly string[]
  defaultMinutes: number
  onAdd: (input: NewItemInput) => Promise<void>
  /** The category's tag field (U5): a Platform picker, a short fixed set, or none. */
  tagField?: TagField | null
  /** Every tag the list's items carry: the Platform picker's "In this list". */
  listTags?: readonly string[]
  /** The tags the last item added to this list used: the next one starts with them. */
  defaultTags?: readonly string[]
}

/**
 * The add-item form at the foot of the list (design: "Add item form"): title,
 * minutes, and a group you pick or type. The item lands at the end of its
 * group (BL-003). The group stays after adding, so a run of items into one
 * group is one field filled in once. So do the tags (U5, docs/chips §4): a
 * Games list picks the next item's platforms in the Platform picker under a
 * button before Add; Music, Animation and Mega pick a Type/Medium.
 */
export function AddItemForm({
  groups,
  defaultMinutes,
  onAdd,
  tagField = null,
  listTags = [],
  defaultTags = [],
}: AddItemFormProps) {
  const text = copy.quantum.list.addItem
  const tagText = copy.quantum.list.tags
  const [tags, setTags] = useState<string[]>(() =>
    tagField?.kind === 'platform'
      ? platformDraft(defaultTags)
      : tagField?.kind === 'choice'
        ? choiceOf(defaultTags, tagField).slice(0, 1)
        : [],
  )
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('')
  const [group, setGroup] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)

  const parsed = parseMinutes(minutes)
  const valid = title.trim() !== '' && !Number.isNaN(parsed)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || adding) return
    setError(null)
    setAdding(true)
    setPickerAnchor(null)

    try {
      await onAdd({ title: title.trim(), minutes: parsed, group: group.trim(), ...(tagField ? { tags } : {}) })
      setTitle('')
      setMinutes('')
      titleInput.current?.focus()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.failed)
    } finally {
      setAdding(false)
    }
  }

  return (
    <form className="q-add-item" onSubmit={(event) => void submit(event)}>
      {error && (
        <ErrorStrip message={error} onRetry={() => setError(null)} onDismiss={() => setError(null)} />
      )}
      <div className="q-add-item-row">
        <Field
          ref={titleInput}
          label={text.titleLabel}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={text.titlePlaceholder}
          spellCheck={false}
          autoComplete="off"
          disabled={adding}
          size="sm"
        />
        <Field
          label={text.minutesLabel}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          placeholder={String(defaultMinutes)}
          inputMode="numeric"
          disabled={adding}
          size="sm"
          className="q-add-item-minutes"
        />
        <GroupCombobox label={text.groupLabel} groups={groups} value={group} onChange={setGroup} small />
        {tagField?.kind === 'choice' && (
          <TagChoice
            label={tagField.label}
            values={tagField.values}
            current={tags}
            onChange={(tag) => setTags(tag ? [tag] : [])}
          />
        )}
        {tagField?.kind === 'platform' && (
          // Labelled above like its neighbours (owner), not inside as in the design.
          <div className="q-field q-add-plat-field">
            <span className="q-kicker" aria-hidden="true">
              {tagText.platform}
            </span>
            <button
              type="button"
              className={pickerAnchor ? 'q-input sm q-add-plat open' : 'q-input sm q-add-plat'}
              aria-label={tagText.nextField(tags.length > 0 ? tags.join(' · ') : tagText.none)}
              aria-expanded={pickerAnchor !== null}
              title={tagText.nextTip}
              onClick={(event) => setPickerAnchor(pickerAnchor ? null : event.currentTarget)}
            >
              <span className={tags.length > 0 ? 'q-add-plat-value' : 'q-add-plat-value empty'}>
                {tags.length > 0 ? tags.join(' · ') : tagText.none}
              </span>
              <ChevronDown className="q-add-plat-caret" width={14} height={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
        <Button variant="primary" size="sm" type="submit" disabled={!valid} busy={adding} busyLabel={text.adding}>
          {text.add}
        </Button>
      </div>
      {tagField?.kind === 'platform' && (
        <Popover
          open={pickerAnchor !== null}
          anchorEl={pickerAnchor}
          onDismiss={() => setPickerAnchor(null)}
          width={320}
          side="below"
          label={tagText.panelLabel}
        >
          <PlatformPicker
            subject={tagText.nextItem}
            note={tagText.nextItemNote}
            selected={tags}
            onChange={setTags}
            inList={listTags}
          />
        </Popover>
      )}
    </form>
  )
}
