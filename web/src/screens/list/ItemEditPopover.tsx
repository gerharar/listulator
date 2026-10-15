import { NAME_MAX_LENGTH } from '../../../../server/src/catalog/limits.js'
import { USER_NOTE_MAX_LENGTH } from '../../../../server/src/catalog/userNotes.js'
import { quitPlatform } from '../../lib/appQuit.js'
import { filterYearInput, formatYear } from '../../../../server/src/catalog/years.js'
import './ItemEditPopover.css'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ItemSourceTags, ListItem } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Field, FieldTextArea } from '../../components/quantum/Field/Field.js'
import { useFieldValidation } from '../../components/quantum/Field/useFieldValidation.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { PlatformPanel } from '../../components/quantum/PlatformPanel/PlatformPanel.js'
import { platformDraft } from '../../components/quantum/PlatformPanel/platformPicks.js'
import { GroupCombobox } from './GroupCombobox.js'
import {
  buildEditPatch,
  durationFieldText,
  minutesProblem,
  minutesSentence,
  titleProblem,
  yearProblem,
  yearSentence,
  type EditDraft,
  type ItemPatch,
} from './itemActions.js'
import { TagChoice } from './TagChoice.js'
import { readChoice, sameChoice, writeChoice, type TagField } from './tagFields.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'

export interface ItemEditPopoverProps {
  item: ListItem
  /** The list's groups, in order. */
  groups: readonly string[]
  /** The category's default length: what an empty Duration means, marked as an estimate (H-006). */
  defaultMinutes: number
  anchorEl: HTMLElement | null
  /**
   * The edits to apply, only ever a draft that can be saved (a wrong field keeps the window open and says what is wrong).
   * `save` is the explicit button or Enter; `clickaway` is the safety net, which the caller answers with an Undo toast.
   */
  onCommit: (patch: ItemPatch, via: 'save' | 'clickaway') => void
  /** Closed without changing anything: Don't Save, Esc, or Save with nothing changed. */
  onDiscard: () => void
  /** The category's tag field (U5): the Platform panel, a short fixed set, or none. */
  tagField?: TagField | null
  /** Every tag the list's items carry: the Platform panel's "In this list". */
  listTags?: readonly string[]
  /** Open with the Platform panel already open: the row's [+] and the platform card's Edit. */
  openPanel?: boolean
  /** Open with the cursor in Note, not Title: the card's ✎ on Your note (H-003). */
  focusNote?: boolean
  /** What the item's source says for its tags: "Source says …" and Reset to source. */
  loadSource?: () => Promise<ItemSourceTags>
}

const joined = (codes: readonly string[]) => codes.join('\n')

/** The counter appears from this many characters (design: H-003). */
const NOTE_COUNTER_FROM = 1800

/**
 * The ✎ popover (design: item edit, 360px): Title, Year beside Duration, Group, and
 * Discard / Save. Clicking away commits what can be saved — "the buttons are the
 * contract; the click-away is the safety net" — but Esc cancels (owner ruling, 2026-09-26: Enter saves, Esc cancels). There is
 * no field for `notes`: they are curator prose and read-only.
 *
 * One rule for a wrong field (H-006): Save is never disabled by a value. Save, Enter and a click away with a wrong Title,
 * Year or Duration save nothing and keep the window open; every wrong field shows its sentence and the cursor goes to the
 * first. Save with nothing changed just closes. An empty Duration is the category's default, marked as an estimate.
 */
export function ItemEditPopover({
  item,
  groups,
  defaultMinutes,
  anchorEl,
  onCommit,
  onDiscard,
  tagField = null,
  listTags = [],
  openPanel = false,
  focusNote = false,
  loadSource,
}: ItemEditPopoverProps) {
  const text = copy.quantum.list.itemActions
  const tagText = copy.quantum.list.tags
  const [title, setTitle] = useState(item.title)
  const [minutes, setMinutes] = useState(() => durationFieldText(item))
  const [group, setGroup] = useState(item.group ?? '')
  const [year, setYear] = useState(() => formatYear(item))
  // The user's own note (H-003): empty for none. The counter shows from 1,800 characters. The shortcut is in the placeholder.
  const [note, setNote] = useState(item.userNote ?? '')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // U5: the tag field's draft. Tags are written only when the field changed them,
  // so an edit of the title never rewrites an old spelling (PC) the item still carries.
  const [platforms, setPlatforms] = useState(() => platformDraft(item.tags))
  const choice = tagField?.kind === 'choice' ? tagField : null
  const [chosen, setChosen] = useState(() => (choice ? readChoice(item.tags, choice) : null))
  const [panelOpen, setPanelOpen] = useState(openPanel && tagField?.kind === 'platform')
  const [source, setSource] = useState<ItemSourceTags | null>(null)
  const editRef = useRef<HTMLDivElement>(null)
  // The card the panel sits beside, taken when the window's body lands in the DOM (the popover is
  // portaled, so it is not there at first render): the panel is not mounted without it, so it never
  // appears at the left edge and then jumps (11.3).
  const [card, setCard] = useState<HTMLElement | null>(null)
  const bindEdit = useCallback((node: HTMLDivElement | null) => {
    editRef.current = node
    setCard(node?.closest<HTMLElement>('.q-pop') ?? null)
  }, [])

  useEffect(() => {
    if (!panelOpen || !loadSource || source) return
    let live = true
    loadSource()
      .then((found) => live && setSource(found))
      .catch(() => undefined) // No "Source says" line: nothing else depends on it.
    return () => {
      live = false
    }
  }, [panelOpen, loadSource, source])

  // A press anywhere in the Edit window closes the panel (owner, U5); the Platform field's
  // own press is left to its click, which toggles it. The panel sits in its own portal, so
  // a press inside it never reaches this window's element.
  useEffect(() => {
    const card = editRef.current?.closest<HTMLElement>('.q-pop')
    if (!panelOpen || !card) return
    const onPress = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.q-platfield')) return
      setPanelOpen(false)
    }
    card.addEventListener('pointerdown', onPress)
    return () => card.removeEventListener('pointerdown', onPress)
  }, [panelOpen])

  let tags: string[] | undefined
  if (tagField?.kind === 'platform' && joined(platforms) !== joined(platformDraft(item.tags))) tags = platforms
  if (choice && chosen && !sameChoice(chosen, readChoice(item.tags, choice))) {
    tags = writeChoice(item.tags, choice, chosen)
  }

  const draft: EditDraft = { title, minutes, group, year, note, ...(tags ? { tags } : {}) }
  const patch = buildEditPatch(item, draft, defaultMinutes)

  // What is wrong with each field, in the order the cursor visits them (H-006). A year or a length the person left as it was
  // is not checked, so a value stored from before cannot stop another edit.
  const checks = useFieldValidation({
    title: { value: title, problem: (value) => (titleProblem(value) ? text.titleRequired : null) },
    year: {
      value: year,
      problem: (value) => {
        const problem = yearProblem(item, value)

        return problem === null ? null : yearSentence(text, problem, value)
      },
    },
    minutes: {
      value: minutes,
      problem: (value) => {
        const problem = minutesProblem(item, value)

        return problem === null ? null : minutesSentence(text, problem, defaultMinutes)
      },
    },
  })

  // Save, Enter and a click away all end here: a wrong field keeps the window open, nothing changed just closes.
  function commit(via: 'save' | 'clickaway') {
    if (!checks.validate()) return
    if (patch) onCommit(patch, via)
    else onDiscard()
  }

  // The note grows with what is typed, from four lines to eight, then scrolls (design: H-003).
  useLayoutEffect(() => {
    const field = noteRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight + 2}px`
  }, [note])

  // Enter saves, Esc cancels. In the note Enter is a new line and Ctrl or ⌘ with Enter saves; not on a button, not in the
  // Platform panel (its search), and not when something inside already took the key.
  function saveOnEnter(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.target instanceof HTMLTextAreaElement) {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
    } else if (event.target instanceof HTMLButtonElement) return
    if (event.target instanceof Element && event.target.closest('.q-platpanel')) return
    commit('save')
  }

  // With the Platform panel open, a click away and Esc close only the panel (docs/chips).
  function dismiss() {
    if (panelOpen) return setPanelOpen(false)
    commit('clickaway')
  }

  function escape() {
    if (panelOpen) return setPanelOpen(false)
    onDiscard()
  }

  const platformValue = platforms.length > 0 ? platforms.join(' · ') : tagText.notSet

  return (
    <Popover open anchorEl={anchorEl} onDismiss={dismiss} onEscape={escape} width={360}>
      <div className="q-edit" onKeyDown={saveOnEnter} ref={bindEdit}>
        <Field
          label={text.editTitle}
          maxLength={NAME_MAX_LENGTH}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus={!panelOpen && !focusNote}
          size="sm"
          {...checks.props('title')}
        />
        {checks.message('title')}
        {/* Year beside the duration on one line (design: H-004); the sentences under the pair, only while a field is wrong. */}
        <div className="q-edit-pair">
          <div className="q-edit-year">
            <Field
              label={text.editYear}
              value={year}
              onChange={(event) => setYear(filterYearInput(event.target.value))}
              maxLength={4}
              placeholder={text.yearPlaceholder}
              inputMode="numeric"
              autoComplete="off"
              size="sm"
              {...checks.props('year')}
            />
          </div>
          <div className="q-edit-grow">
            <Field
              label={text.editMinutes}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              placeholder={text.minutesPlaceholder(defaultMinutes)}
              autoComplete="off"
              spellCheck={false}
              size="sm"
              {...checks.props('minutes')}
            />
          </div>
        </div>
        {checks.message('year')}
        {checks.message('minutes')}
        <GroupCombobox label={text.editGroup} groups={groups} value={group} onChange={setGroup} small />
        {tagField?.kind === 'platform' && (
          <div className="q-field">
            <span className="q-kicker" aria-hidden="true">
              {tagText.platform}
            </span>
            <Tip
              as="button"
              type="button"
              className={panelOpen ? 'q-input sm q-platfield open' : 'q-input sm q-platfield'}
              aria-label={tagText.fieldLabel(tagText.platform, platformValue)}
              aria-expanded={panelOpen}
              text={tagText.fieldTip}
              describe
              onClick={() => setPanelOpen((was) => !was)}
            >
              <span className={platforms.length > 0 ? 'q-platfield-value' : 'q-platfield-value empty'}>
                {platformValue}
              </span>
              <span className="q-platfield-caret" aria-hidden="true">
                {panelOpen ? '‹' : '›'}
              </span>
            </Tip>
          </div>
        )}
        {choice && (
          <TagChoice field={choice} current={chosen!} onChange={setChosen} />
        )}
        {/* A press on a button keeps the cursor in its field: leaving it would show a sentence above the buttons, move them
            down while the mouse is still pressed, and drop the click. The keyboard is not affected. */}
        {/* Note is the last field, under Group and Platform (design: H-003). */}
        <div className="q-edit-note-block">
          <FieldTextArea
            ref={noteRef}
            className="q-edit-note"
            label={text.editNote}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={USER_NOTE_MAX_LENGTH}
            placeholder={quitPlatform(navigator.userAgent) === 'mac' ? text.notePlaceholderCmd : text.notePlaceholderCtrl}
            autoFocus={focusNote && !panelOpen}
          />
          {note.length >= NOTE_COUNTER_FROM && (
            <div className="q-edit-note-meta">{text.noteCounter(note.length, USER_NOTE_MAX_LENGTH)}</div>
          )}
        </div>
        <div className="q-edit-actions" onMouseDown={(event) => event.preventDefault()}>
          <Button size="sm" variant="quiet" onClick={onDiscard}>
            {text.discard}
          </Button>
          <Button size="sm" variant="primary" onClick={() => commit('save')}>
            {text.save}
          </Button>
        </div>
      </div>
      {panelOpen && (
        <PlatformPanel
          reference={card}
          subject={item.title}
          selected={platforms}
          onChange={setPlatforms}
          inList={listTags}
          source={source}
        />
      )}
    </Popover>
  )
}
