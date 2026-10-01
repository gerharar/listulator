import { Button } from '../../components/quantum/Button/Button.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import type { UpdateCheckState } from '../../lib/appUpdate.js'
import { copy } from '../../locale/index.js'

/**
 * What the block is showing. `unavailable` is not in the design: it is the state of an app with no updater
 * yet (owner's rulings, 2026-10-01: never claim "up to date" without a check, and the real updater comes
 * later), so it says so and offers a disabled button.
 */
export type UpdateBlockState = UpdateCheckState

export interface UpdateBlockProps {
  state: UpdateBlockState
  /** The version this build carries. */
  current: string
  /** The version an update offers; only read in the `available` state. */
  next?: string
  /** Check for updates, and Try Again. */
  onCheck: () => void
  /** Download Update: hands off to the app's update flow. */
  onDownload: () => void
}

/** The status line for a state, as the block shows it and as a reader is told it. */
export function updateStatusText(state: UpdateBlockState): string {
  const text = copy.quantum.about
  const lines: Record<UpdateBlockState, string> = {
    latest: text.upToDate,
    checking: text.checking,
    available: text.available,
    error: text.failed,
    unavailable: text.updatesLater,
  }

  return lines[state]
}

/** "Version 1.0.0." or, with an update to offer, "Version 1.0.0 → 1.1.0.". */
export function updateVersionText(current: string, next?: string): string {
  const label = copy.quantum.about.version

  return next === undefined ? `${label} ${current}.` : `${label} ${current} → ${next}.`
}

/**
 * Every variant of one text, stacked in the same grid cell. Only the active one is visible; the others are
 * `visibility:hidden` (CSS) and `aria-hidden`, so the cell is always as wide as its longest variant and the
 * block never changes size when its state does (design: "zero layout shift", required).
 */
function Stack<Key extends string>({ active, variants }: { active: Key; variants: readonly { key: Key; text: string }[] }) {
  return (
    <span className="q-about-stack">
      {variants.map((variant) => (
        <span key={variant.key} className={variant.key === active ? undefined : 'off'} aria-hidden={variant.key === active ? undefined : true}>
          {variant.text}
        </span>
      ))}
    </span>
  )
}

/**
 * The update-status block on the About screen (docs/design/about-updates, 1b): a compact card with the status,
 * the version and one action. Presentational: which state it is in, and what the actions do, come from outside.
 */
export function UpdateBlock({ state, current, next, onCheck, onDownload }: UpdateBlockProps) {
  const text = copy.quantum.about
  const busy = state === 'checking'
  const disabled = busy || state === 'unavailable'

  return (
    <div className="q-about-update-block">
      <HeaderPlate side="left" seed={6} wash />
      <div className="q-about-update-text" role="status">
        <Stack
          active={state}
          variants={(['latest', 'checking', 'available', 'error', 'unavailable'] as const).map((key) => ({ key, text: updateStatusText(key) }))}
        />
        {/* The arrow line is always in the page, so its width is already reserved when an update turns up; without a known version it holds a stand-in of the same length. */}
        <span className="q-about-version-line">
          <Stack
            active={state === 'available' ? 'arrow' : 'plain'}
            variants={[
              { key: 'plain', text: updateVersionText(current) },
              { key: 'arrow', text: updateVersionText(current, next ?? current) },
            ]}
          />
        </span>
      </div>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        {...(state === 'unavailable' ? { title: text.updatesLater } : {})}
        onClick={state === 'available' ? onDownload : onCheck}
      >
        <Stack
          active={state === 'latest' || state === 'unavailable' ? 'check' : state === 'checking' ? 'checking' : state === 'available' ? 'download' : 'retry'}
          variants={[
            { key: 'check', text: text.checkForUpdates },
            { key: 'checking', text: text.checking },
            { key: 'download', text: text.download },
            { key: 'retry', text: text.retry },
          ]}
        />
      </Button>
    </div>
  )
}
