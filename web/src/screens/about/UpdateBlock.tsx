import { RefreshCw } from 'lucide-react'
import { Button } from '../../components/quantum/Button/Button.js'
import { ExternalLink } from '../../components/quantum/ExternalLink/ExternalLink.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { quitPlatform } from '../../lib/appQuit.js'
import type { UpdateCheckState, UpdatePhase } from '../../lib/appUpdate.js'
import { CHANGELOG_URL } from '../../lib/dataSources.js'
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
  /** The version an update offers; read from the `available` state on (the in-progress states and `installError` keep showing it). */
  next?: string
  /** Check for updates, and Try Again. */
  onCheck: () => void
  /** Download Update: hands off to the app's update flow. */
  onDownload: () => void
  /** Which notice to give; the platform this window runs on when left out. */
  platform?: UpdatePlatform
}

/**
 * `mac` restarts quickly; every other desktop platform is Windows, whose installer closes the window for a while (H-017, BL-092). Only the two ship
 * (Windows and macOS builds), so "not a Mac" is "Windows". Linux is not a target platform; design groups it with macOS if it ever becomes one.
 */
export type UpdatePlatform = ReturnType<typeof quitPlatform>

/** Every state, in the order the status lines are stacked. */
const STATES = ['latest', 'checking', 'available', 'error', 'unavailable', 'installError', 'installStuck', 'downloading', 'installing', 'restarting'] as const satisfies readonly UpdateBlockState[]

/** The update itself is running: after the press on Download Update, until the app is replaced. */
function inProgress(state: UpdateBlockState): state is UpdatePhase {
  return state === 'downloading' || state === 'installing' || state === 'restarting'
}

/**
 * Whether the notice row ("the window closes and reopens", canvas H-017) is in the block: from the offer on, through the update. The
 * window is hidden during the install, so the notice has to be on screen before it; the states that have no update to install have no row at all
 * (an empty band in the card looks bad, owner 2026-10-20).
 */
export function showsUpdateNotice(state: UpdateBlockState): boolean {
  return state === 'available' || inProgress(state)
}

/** The notice for a platform: Windows closes the window for the installer's gap, macOS restarts at once. */
export function updateNoticeText(platform: UpdatePlatform = quitPlatform(navigator.userAgent)): string {
  const text = copy.quantum.about

  return platform === 'mac' ? text.updateNoticeRestart : text.updateNoticeWindows
}

/** Which of the stacked button labels a state shows. */
function buttonFor(state: UpdateBlockState): 'check' | 'checking' | 'download' | 'retry' | UpdatePhase {
  if (inProgress(state)) return state
  if (state === 'checking') return 'checking'
  if (state === 'available') return 'download'
  return state === 'error' || state === 'installError' || state === 'installStuck' ? 'retry' : 'check'
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
    installError: text.installFailed,
    installStuck: text.installStuck,
    downloading: text.downloadingUpdate,
    installing: text.installingUpdate,
    restarting: text.restarting,
  }

  return lines[state]
}

/**
 * "Version 1.0.0" or, with an update to offer, "Version 1.0.0 → 1.1.0". No full stop: the Changelog link follows it
 * on the same line, and a dot there pushed the link away (owner, 2026-10-05).
 */
export function updateVersionText(current: string, next?: string): string {
  const label = copy.quantum.about.version

  return next === undefined ? `${label} ${current}` : `${label} ${current} → ${next}`
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
export function UpdateBlock({ state, current, next, onCheck, onDownload, platform }: UpdateBlockProps) {
  const text = copy.quantum.about
  // No action while a check or the update itself runs, or where there is no updater to ask.
  const disabled = state === 'checking' || state === 'unavailable' || inProgress(state)
  // The version line shows the update's version from the offer on, and keeps it after a failed install.
  const showsNext = state === 'available' || state === 'installError' || state === 'installStuck' || inProgress(state)

  return (
    <div className="q-about-update-block">
      <HeaderPlate side="left" seed={6} wash />
      <div className="q-about-update-text" role="status">
        <Stack
          active={state}
          variants={STATES.map((key) => ({ key, text: updateStatusText(key) }))}
        />
        {/* The arrow line is always in the page, so its width is already reserved when an update turns up; without a known version it holds a stand-in of the same length. The changelog link rides in each variant, so it follows the version shown with no gap (owner, 2026-10-05); the hidden copy is invisible, so neither seen, read out nor focused. */}
        <span className="q-about-version-line">
          <span className="q-about-stack">
            {(['plain', 'arrow'] as const).map((key) => {
              const active = (showsNext ? 'arrow' : 'plain') === key
              return (
                <span key={key} className={active ? undefined : 'off'} aria-hidden={active ? undefined : true}>
                  <span className="q-about-version-text">
                    {key === 'plain' ? updateVersionText(current) : updateVersionText(current, next ?? current)}
                  </span>
                  <span className="q-about-sep" aria-hidden="true">
                    ·
                  </span>
                  <ExternalLink className="q-about-credit-link" href={CHANGELOG_URL}>
                    {text.changelog}
                    <span aria-hidden="true">↗</span>
                  </ExternalLink>
                </span>
              )
            })}
          </span>
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
          active={buttonFor(state)}
          variants={[
            { key: 'check', text: text.checkForUpdates },
            { key: 'checking', text: text.checking },
            { key: 'download', text: text.download },
            { key: 'retry', text: text.retry },
            { key: 'downloading', text: text.downloading },
            { key: 'installing', text: text.installing },
            { key: 'restarting', text: text.restarting },
          ]}
        />
      </Button>
      {showsUpdateNotice(state) && (
        <p className="q-about-update-notice">
          <RefreshCw width={13} height={13} aria-hidden="true" />
          <span>{updateNoticeText(platform)}</span>
        </p>
      )}
    </div>
  )
}
