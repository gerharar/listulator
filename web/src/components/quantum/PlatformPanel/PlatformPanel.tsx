import './PlatformPanel.css'
import { useState } from 'react'
import { FloatingPortal, autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react'
import { platformName } from '../../../../../server/src/catalog/platforms.js'
import type { ItemSourceTags } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import {
  MATCH_CAP,
  PLATFORM_COUNT,
  panelContent,
  platformDraft,
  togglePlatform,
  type PanelSection,
} from './platformPicks.js'

export interface PlatformPanelProps {
  /** The element the panel sits beside: the open Edit window. */
  reference: HTMLElement | null
  /** Whose platforms: the item's title. */
  subject: string
  selected: readonly string[]
  onChange: (next: string[]) => void
  /** Every tag the list's items carry, for "In this list". */
  inList: readonly string[]
  /** What the source says for the item; null while not known, or when it has none. */
  source: ItemSourceTags | null
}

const joined = (codes: readonly string[]) => codes.join(' · ')

/**
 * The Platform panel (U5, design: docs/chips §3): beside the Edit window, the
 * way the design places its side panels, flipping to the other side when there
 * is no room. Header with Clear, the item, the picks as removable tokens, a
 * search over the whole table, the list (In this list, Most common —
 * or the matches), and, when the draft differs from the
 * source, what the source says with Reset to source. Every change goes to the
 * Edit window's draft; the window's Save or click-away commits it.
 */
export function PlatformPanel({ reference, subject, selected, onChange, inList, source }: PlatformPanelProps) {
  const text = copy.quantum.list.tags
  const [query, setQuery] = useState('')

  const { refs, floatingStyles } = useFloating({
    open: true,
    placement: 'right-start',
    elements: { reference },
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ['left-start', 'right-end', 'left-end'] }),
      shift({ padding: 8 }),
      size({
        padding: 12,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.min(460, Math.max(availableHeight, 200))}px`
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  })

  const content = panelContent(query, inList)
  const pick = (code: string) => onChange(togglePlatform(selected, code))
  const sourceCodes = source?.sourced ? platformDraft(source.tags) : null
  const showSource = sourceCodes !== null && joined(sourceCodes) !== joined(selected)

  const sectionName = (section: PanelSection) =>
    section.key === 'inList'
      ? text.inList
      : section.key === 'common'
        ? text.common
        : text.matches(section.total ?? section.codes.length)

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="q-platpanel"
        role="dialog"
        aria-label={text.panelLabel}
      >
        <div className="q-platpanel-head">
          <span className="q-platpanel-kicker">{text.head(selected.length)}</span>
          {selected.length > 0 && (
            <button type="button" className="q-platpanel-clear" title={text.clearTip} onClick={() => onChange([])}>
              {text.clear}
            </button>
          )}
        </div>

        <div className="q-platpanel-subject">
          <span className="q-platpanel-title">{subject}</span>
          {selected.length === 0 && <span className="q-platpanel-note">{text.notSetNote}</span>}
        </div>

        {selected.length > 0 && (
          <div className="q-platpanel-tokens">
            {selected.map((code) => (
              <button
                key={code}
                type="button"
                className="q-platpanel-token"
                title={text.removeTip(platformName(code) ?? code)}
                onClick={() => onChange(selected.filter((entry) => entry !== code))}
              >
                {code}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}

        <input
          className="q-platpanel-search"
          type="text"
          value={query}
          placeholder={text.search(PLATFORM_COUNT)}
          aria-label={text.search(PLATFORM_COUNT)}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />

        <div className="q-platpanel-list">
          {content.sections.map((section) => (
            <div key={section.key} role="group" aria-label={sectionName(section)}>
              <div className="q-platpanel-section">{sectionName(section)}</div>
              {section.codes.map((code) => {
                const on = selected.includes(code)
                return (
                  <button key={code} type="button" className="q-platpanel-row" aria-pressed={on} onClick={() => pick(code)}>
                    <span className="q-platpanel-box" aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                    <span className="q-platpanel-code">{code}</span>
                    <span className="q-platpanel-name">{platformName(code)}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {content.noMatch && <p className="q-platpanel-foot">{text.noMatch(query.trim())}</p>}
          {!query.trim() && <p className="q-platpanel-foot">{text.browseFoot(PLATFORM_COUNT)}</p>}
          {content.hidden > 0 && <p className="q-platpanel-foot">{text.moreFoot(MATCH_CAP, content.hidden + MATCH_CAP)}</p>}
        </div>

        {showSource && (
          <div className="q-platpanel-source">
            <span>{text.sourceSays(joined(sourceCodes))}</span>
            <button type="button" onClick={() => onChange(sourceCodes)}>
              {text.resetToSource}
            </button>
          </div>
        )}
      </div>
    </FloatingPortal>
  )
}
