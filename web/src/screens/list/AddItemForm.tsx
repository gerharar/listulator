import { NAME_MAX_LENGTH } from '../../../../server/src/catalog/limits.js'
import { durationTextProblem, parseDurationText } from '../../../../server/src/catalog/durations.js'
import { filterYearInput, parseYearText, yearTextProblem } from '../../../../server/src/catalog/years.js'
import './AddItemForm.css'
import { useRef, useState, type FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { ErrorStrip } from '../../components/quantum/ErrorStrip/ErrorStrip.js'
import { Field } from '../../components/quantum/Field/Field.js'
import { useFieldValidation } from '../../components/quantum/Field/useFieldValidation.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { PlatformPicker } from '../../components/quantum/PlatformPanel/PlatformPanel.js'
import { platformDraft } from '../../components/quantum/PlatformPanel/platformPicks.js'
import { GroupCombobox } from './GroupCombobox.js'
import { minutesSentence, yearSentence } from './itemActions.js'
import { TagChoice } from './TagChoice.js'
import { readChoice, writeChoice, type TagField } from './tagFields.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'

export interface NewItemInput {
  title: string
  /** `null`: the category's default, estimated. */
  minutes: number | null
  /** Empty: no group. A name the list lacks creates the group. */
  group: string
  /** The year, with how many of its last digits are unknown (H-004, H-005); absent: no year. */
  year?: { year: number; yearUnk: number }
  /** The new item's tags (U5), only where the category has a tag field. */
  tags?: string[]
}

export interface AddItemFormProps {
  /** The list's groups, in order. */
  groups: readonly string[]
  defaultMinutes: number
  onAdd: (input: NewItemInput) => Promise<void>
  /**
   * A group name with no title makes that empty group (11.17). Left out, Add still needs a title.
   * Throws the API's own refusal (an empty or already-used name), which the form shows.
   */
  onCreateGroup?: (name: string) => Promise<void>
  /** The category's tag field (U5): a Platform picker, a short fixed set, or none. */
  tagField?: TagField | null
  /** Every tag the list's items carry: the Platform picker's "In this list". */
  listTags?: readonly string[]
  /** The tags the last item added to this list used: the next one starts with them. */
  defaultTags?: readonly string[]
}

/**
 * The add-item form at the foot of the list (design: "Add item form"): title,
 * year, minutes, and a group you pick or type. The item lands at the end of its
 * group (BL-003). The group stays after adding, so a run of items into one
 * group is one field filled in once. So do the tags (U5, docs/chips §4): a
 * Games list picks the next item's platforms in the Platform picker under a
 * button before Add; Music, Animation and Mega pick a Type/Medium.
 *
 * One rule for a wrong field (H-006): Add is never disabled by a value. Pressing it with no title (and no new group name),
 * a wrong year or a wrong length adds nothing, shows each wrong field's sentence under the row, title first, and puts the
 * cursor on the first. A wrong year or length blocks a group-only add too. Minutes are read as 95, 1h 35m or 1:35; empty
 * is the category's default, estimated.
 */
export function AddItemForm({
  groups,
  defaultMinutes,
  onAdd,
  onCreateGroup,
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
        ? writeChoice([], tagField, readChoice(defaultTags, tagField))
        : [],
  )
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [minutes, setMinutes] = useState('')
  const [group, setGroup] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)

  const sentences = copy.quantum.list.itemActions
  // No title but a group name: the group itself is what is being added.
  const makesGroup = onCreateGroup !== undefined && title.trim() === '' && group.trim() !== ''
  const hasTitleOrGroup = title.trim() !== '' || makesGroup

  // The cursor and the sentences go in this order: the title, the year, the length (the design's).
  const checks = useFieldValidation({
    title: {
      value: title,
      problem: () => (hasTitleOrGroup ? null : onCreateGroup ? text.titleOrGroupRequired : sentences.titleRequired),
    },
    year: {
      value: year,
      problem: (value) => {
        const problem = yearTextProblem(value)

        return problem === null ? null : yearSentence(sentences, problem, value)
      },
    },
    minutes: {
      value: minutes,
      problem: (value) => {
        const problem = durationTextProblem(value)

        return problem === null ? null : minutesSentence(sentences, problem, defaultMinutes)
      },
    },
  })
  const titleChecks = checks.props('title')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (adding || !checks.validate()) return
    setError(null)
    setAdding(true)
    setPickerAnchor(null)

    try {
      if (makesGroup) {
        await onCreateGroup(group.trim())
        titleInput.current?.focus()
        return
      }
      const typedYear = parseYearText(year)
      await onAdd({
        title: title.trim(),
        minutes: parseDurationText(minutes) ?? null,
        group: group.trim(),
        ...(typedYear?.year ? { year: { year: typedYear.year, yearUnk: typedYear.yearUnk } } : {}),
        ...(tagField ? { tags } : {}),
      })
      setTitle('')
      setYear('')
      setMinutes('')
      checks.reset()
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
          {...titleChecks}
          ref={(element) => {
            titleInput.current = element as HTMLInputElement | null
            titleChecks.ref(element)
          }}
          label={text.titleLabel}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={text.titlePlaceholder}
          maxLength={NAME_MAX_LENGTH}
          spellCheck={false}
          autoComplete="off"
          disabled={adding}
          size="sm"
        />
        <Field
          label={text.yearLabel}
          value={year}
          onChange={(event) => setYear(filterYearInput(event.target.value))}
          placeholder={text.yearPlaceholder}
          maxLength={4}
          inputMode="numeric"
          autoComplete="off"
          disabled={adding}
          size="sm"
          className="q-add-item-year"
          {...checks.props('year')}
        />
        <Field
          label={text.minutesLabel}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          placeholder={String(defaultMinutes)}
          spellCheck={false}
          autoComplete="off"
          disabled={adding}
          size="sm"
          className="q-add-item-minutes"
          {...checks.props('minutes')}
        />
        <GroupCombobox label={text.groupLabel} groups={groups} value={group} onChange={setGroup} small />
        {tagField?.kind === 'choice' && (
          <TagChoice
            field={tagField}
            current={readChoice(tags, tagField)}
            onChange={(next) => setTags(writeChoice(tags, tagField, next))}
          />
        )}
        {tagField?.kind === 'platform' && (
          // Labelled above like its neighbours (owner), not inside as in the design.
          <div className="q-field q-add-plat-field">
            <span className="q-kicker" aria-hidden="true">
              {tagText.platform}
            </span>
            <Tip
              as="button"
              type="button"
              className={pickerAnchor ? 'q-input sm q-add-plat open' : 'q-input sm q-add-plat'}
              aria-label={tagText.nextField(tags.length > 0 ? tags.join(' · ') : tagText.none)}
              aria-expanded={pickerAnchor !== null}
              text={tagText.nextTip}
              describe
              onClick={(event) => setPickerAnchor(pickerAnchor ? null : event.currentTarget)}
            >
              <span className={tags.length > 0 ? 'q-add-plat-value' : 'q-add-plat-value empty'}>
                {tags.length > 0 ? tags.join(' · ') : tagText.none}
              </span>
              <ChevronDown className="q-add-plat-caret" width={14} height={14} strokeWidth={2} aria-hidden="true" />
            </Tip>
          </div>
        )}
        <Button
          variant="primary"
          size="sm"
          type="submit"
          busy={adding}
          busyLabel={text.adding}
        >
          {makesGroup ? text.addGroup : text.add}
        </Button>
      </div>
      {/* The sentences of the wrong fields, under the whole row, the title first (design: H-006). */}
      <div className="q-add-item-msgs">
        {checks.message('title')}
        {checks.message('year')}
        {checks.message('minutes')}
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
