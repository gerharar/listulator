import { NAME_MAX_LENGTH } from '../../../../server/src/catalog/limits.js'
import './ItemEditPopover.css'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ItemSourceTags, ListItem } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Field } from '../../components/quantum/Field/Field.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { PlatformPanel } from '../../components/quantum/PlatformPanel/PlatformPanel.js'
import { platformDraft } from '../../components/quantum/PlatformPanel/platformPicks.js'
import { GroupCombobox } from './GroupCombobox.js'
import { buildEditPatch, type ItemPatch } from './itemActions.js'
import { TagChoice } from './TagChoice.js'
import { readChoice, sameChoice, writeChoice, type TagField } from './tagFields.js'

export interface ItemEditPopoverProps {
  item: ListItem
  /** The list's groups, in order. */
  groups: readonly string[]
  anchorEl: HTMLElement | null
  /**
   * The edits to apply. `save` is the explicit button; `clickaway` is the
   * safety net, which the caller answers with an Undo toast.
   */
  onCommit: (patch: ItemPatch, via: 'save' | 'clickaway') => void
  /** Closed without changing anything. */
  onDiscard: () => void
  /** The category's tag field (U5): the Platform panel, a short fixed set, or none. */
  tagField?: TagField | null
  /** Every tag the list's items carry: the Platform panel's "In this list". */
  listTags?: readonly string[]
  /** Open with the Platform panel already open: the row's [+] and the platform card's Edit. */
  openPanel?: boolean
  /** What the item's source says for its tags: "Source says …" and Reset to source. */
  loadSource?: () => Promise<ItemSourceTags>
}

const joined = (codes: readonly string[]) => codes.join('\n')

/**
 * The ✎ popover (design: item edit, 360px): Title, Minutes, Group, and
 * Discard / Save. Clicking away commits what can be saved — "the buttons are the
 * contract; the click-away is the safety net" — but Esc cancels (owner ruling, 2026-09-26: Enter saves, Esc cancels). There is
 * no field for `notes`: they are curator prose and read-only.
 */
export function ItemEditPopover({
  item,
  groups,
  anchorEl,
  onCommit,
  onDiscard,
  tagField = null,
  listTags = [],
  openPanel = false,
  loadSource,
}: ItemEditPopoverProps) {
  const text = copy.quantum.list.itemActions
  const tagText = copy.quantum.list.tags
  const [title, setTitle] = useState(item.title)
  const [minutes, setMinutes] = useState(String(item.timeToConsumeMinutes))
  const [group, setGroup] = useState(item.group ?? '')

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

  const patch = buildEditPatch(item, { title, minutes, group, ...(tags ? { tags } : {}) })

  // Enter saves, Esc cancels. Not in a text area (Enter is a new line there), not in
  // the Platform panel (its search), and not when something inside already took the key.
  function saveOnEnter(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) return
    if (event.target instanceof Element && event.target.closest('.q-platpanel')) return
    if (patch) onCommit(patch, 'save')
  }

  // With the Platform panel open, a click away and Esc close only the panel (docs/chips).
  function dismiss() {
    if (panelOpen) return setPanelOpen(false)
    if (patch) onCommit(patch, 'clickaway')
    else onDiscard()
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
          autoFocus={!panelOpen}
          size="sm"
        />
        <Field
          label={text.editMinutes}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          inputMode="numeric"
          size="sm"
        />
        <GroupCombobox label={text.editGroup} groups={groups} value={group} onChange={setGroup} small />
        {tagField?.kind === 'platform' && (
          <div className="q-field">
            <span className="q-kicker" aria-hidden="true">
              {tagText.platform}
            </span>
            <button
              type="button"
              className={panelOpen ? 'q-input sm q-platfield open' : 'q-input sm q-platfield'}
              aria-label={tagText.fieldLabel(tagText.platform, platformValue)}
              aria-expanded={panelOpen}
              title={tagText.fieldTip}
              onClick={() => setPanelOpen((was) => !was)}
            >
              <span className={platforms.length > 0 ? 'q-platfield-value' : 'q-platfield-value empty'}>
                {platformValue}
              </span>
              <span className="q-platfield-caret" aria-hidden="true">
                {panelOpen ? '‹' : '›'}
              </span>
            </button>
          </div>
        )}
        {choice && (
          <TagChoice field={choice} current={chosen!} onChange={setChosen} />
        )}
        <div className="q-edit-actions">
          <Button size="sm" variant="quiet" onClick={onDiscard}>
            {text.discard}
          </Button>
          <Button size="sm" variant="primary" disabled={!patch} onClick={() => patch && onCommit(patch, 'save')}>
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
