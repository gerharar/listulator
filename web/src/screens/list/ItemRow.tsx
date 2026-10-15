import './Spine.css'
import type { AnchorHTMLAttributes, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { ArrowUpRight, Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { approximateDecade, formatYear } from '../../../../server/src/catalog/years.js'
import { lengthLabel } from './lengthLabel.js'
import { itemNotes, notesLabel } from './itemNotes.js'
import { copy } from '../../locale/index.js'
import type { ListItem } from '../../lib/api.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { DoneCheckbox } from '../../components/quantum/DoneCheckbox/DoneCheckbox.js'
import { KindTag, ManualMark, NewBadge } from '../../components/quantum/Marks/Marks.js'
import type { TagChip } from '../../../../server/src/catalog/facets.js'
import { PlatformChip } from '../../components/quantum/PlatformChip/PlatformChip.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import { useTooltip } from '../../components/quantum/Tooltip/useTooltip.js'
import { ExternalLink } from '../../components/quantum/ExternalLink/ExternalLink.js'

export interface ItemRowProps {
  item: ListItem
  /** Inside a group: indented under its head. */
  grouped: boolean
  /** The list's one tab stop (roving focus). */
  focusable: boolean
  /** The runtime column, as wide as the list's longest value (`ch`). */
  minutesWidth: number
  onToggle: (item: ListItem) => void
  onFocus: (item: ListItem) => void
  /** The row's own buttons; each gets the button, to anchor a popover to. */
  onInfo: (item: ListItem, anchor: HTMLElement) => void
  onEdit: (item: ListItem, anchor: HTMLElement) => void
  onRemove: (item: ListItem, anchor: HTMLElement) => void
  /** Just added, moved or restored: wash the row so the eye can find where it went. */
  pulse: boolean
  /** A drag starts here: the handle's own pointer-down (10.23). */
  onHandlePointerDown?: (event: PointerEvent, item: ListItem) => void
  /** This is the row being dragged. */
  dragging?: boolean
  /** The drop line, when a drag would land just above or just below this row. */
  dropLine?: 'before' | 'after' | null
  /**
   * A category whose tags name platforms shows a platform chip in the tag
   * column instead of the first tag as a plain label; `widthCh` is the widest
   * chip label on the list, so the column lines up.
   */
  platform?: { widthCh: number; onOpen: (item: ListItem, anchor: HTMLElement) => void }
  /** What the tag column's chip shows: the category's value (`game` → Game, EP → Mini) and any flag, as a mark on it (Live). */
  tagChip?: TagChip
  /**
   * An untagged item's [+] (U5): given once the list has tags and the category
   * has a tag field. `label` names the field for a short fixed set (Medium,
   * Type); a platform category's [+] sits in the chip's own slot.
   */
  addTag?: { label: string; onAdd: (item: ListItem, anchor: HTMLElement) => void }
  /**
   * The list mixes hand-added and imported items, so the hand says which are which. In an
   * all-manual list the header's hand already says it, and a hand on every row is noise (11.9).
   */
  showManual?: boolean
  /** The filter text is in this row's note and not in its title (H-003): the ⓘ lights, and says whose note it is. */
  noteMatch?: 'curator' | 'mine' | null
}

/**
 * The ↗ after the pencil (H-002, BL-087): the item's page at its source, in the system browser on desktop. A link and
 * not a button, so it can be opened in a tab, copied and read out as one. It must not also toggle the row it sits in.
 */
function SourceLink({ url, source, title }: { url: string; source: string; title: string }) {
  const text = copy.quantum.list.itemActions
  const tip = useTooltip(text.openOnSourceTip(source))
  const own: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string } = {
    href: url,
    className: 'q-icon-btn row link',
    'aria-label': text.openOnSource(title, source),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation(),
  }

  return (
    <>
      <ExternalLink {...tip.props(own)}>
        <ArrowUpRight width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
      </ExternalLink>
      {tip.node}
    </>
  )
}

/**
 * One 46px band (design-system/components/ItemRow), read-only for now: the
 * done box, the kind tag, the title with its year, and the runtime. Clicking
 * anywhere on the row toggles done. The handle starts a drag (10.23); the
 * rest of the row stays free to scroll on touch.
 */
export function ItemRow({
  item,
  grouped,
  focusable,
  minutesWidth,
  onToggle,
  onFocus,
  onInfo,
  onEdit,
  onRemove,
  pulse,
  onHandlePointerDown,
  dragging = false,
  dropLine = null,
  platform,
  tagChip,
  addTag,
  showManual = false,
  noteMatch = null,
}: ItemRowProps) {
  const text = copy.quantum.list.itemActions
  const tagText = copy.quantum.list.tags
  const done = item.consumedAt !== null
  const decade = approximateDecade(item)
  const yearTip = decade ? text.sometimeIn(decade) : text.releaseYear
  const kind = tagChip?.label ?? item.tags?.[0]
  // The ⓘ is only for an item with a note, named for whose it is (H-003); nothing keeps its place when there is none.
  const noteLabel = notesLabel(itemNotes(item), text)

  /** A row button acts on its own: it must not also toggle the row it sits in. */
  const act =
    (handler: (item: ListItem, anchor: HTMLElement) => void) => (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation()
      handler(item, event.currentTarget)
    }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Only when the row itself has focus, not a control inside it.
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(item)
    }
  }

  return (
    <div
      className={['q-item', grouped && 'in-group', done && 'is-done', pulse && 'pulse', dragging && 'dragging']
        .filter(Boolean)
        .join(' ')}
      data-row-id={item.id}
      data-drag-key={item.id}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onToggle(item)}
      onKeyDown={onKeyDown}
      onFocus={() => onFocus(item)}
    >
      {dropLine && <span className={dropLine === 'after' ? 'q-dropline after' : 'q-dropline'} />}
      <Tip
        className="q-handle"
        aria-hidden="true"
        text={item.group ? text.dragWithin(item.group) : text.dragOnList}
        onPointerDown={(event) => onHandlePointerDown?.(event, item)}
        onClick={(event) => event.stopPropagation()}
      >
        ⣿
      </Tip>
      {/* The row's own click does the toggling, so the box only has to look right. */}
      <DoneCheckbox checked={done} onChange={() => {}} label={item.title} />
      {(platform || kind || addTag || (showManual && item.source === 'manual')) && (
        <span className="tags">
          {platform ? (
            <PlatformChip
              tags={item.tags ?? []}
              widthCh={platform.widthCh}
              itemTitle={item.title}
              onOpen={(anchor) => platform.onOpen(item, anchor)}
              onAdd={addTag && ((anchor) => addTag.onAdd(item, anchor))}
            />
          ) : kind ? (
            <KindTag label={kind} kind flags={tagChip?.flags} />
          ) : (
            addTag && (
              <Tip
                as="button"
                type="button"
                className="q-tag kind q-tag-add"
                aria-label={tagText.addChoice(addTag.label, item.title)}
                text={tagText.addChoiceTip(addTag.label)}
                describe
                onClick={act(addTag.onAdd)}
              >
                <Plus width={11} height={11} strokeWidth={3} aria-hidden="true" />
              </Tip>
            )
          )}
          {showManual && item.source === 'manual' && <ManualMark />}
        </span>
      )}
      <span className="body">
        <span className="tt">
          <Tip className="title" text={item.title} whenClipped>
            {item.title}
          </Tip>
          {item.year ? (
            <Tip className="q-year" text={yearTip} aria-label={yearTip}>
              ({formatYear(item)})
            </Tip>
          ) : null}
        </span>
        {/* ⓘ and ✎ sit in the title's own group (the prototype's), so they get its 9px gap. */}
        {noteLabel && (
          <IconButton
            size="row"
            className={noteMatch ? 'info lit' : 'info'}
            label={noteMatch ? text.noteForMatch(noteLabel, item.title) : text.noteFor(noteLabel, item.title)}
            title={noteMatch ? (noteMatch === 'mine' ? text.yourNoteMatches : text.curatorNoteMatches) : noteLabel}
            onClick={act(onInfo)}
          >
            <Info width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        )}
        <IconButton size="row" className="edit" label={text.edit(item.title)} onClick={act(onEdit)}>
          <Pencil width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
        {item.link && <SourceLink url={item.link.url} source={item.link.source} title={item.title} />}
      </span>
      {item.isNew && <NewBadge />}
      <span className="spacer" />
      <Tip
        className={item.runtimePending ? 'q-mins pending' : 'q-mins'}
        style={{ width: `${minutesWidth}ch` }}
        text={item.timeToConsumeIsEstimated && !item.runtimePending ? text.estimated : undefined}
      >
        {lengthLabel(item, text.runtimePending)}
      </Tip>
      <IconButton size="row" className="remove" label={text.remove(item.title)} onClick={act(onRemove)}>
        <Trash2 width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
    </div>
  )
}
