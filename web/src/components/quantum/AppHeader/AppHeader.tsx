import './AppHeader.css'
import { useEffect, useRef, useState } from 'react'
import { Info, Power, Settings } from 'lucide-react'
import { IconButton } from '../Button/Button.js'
import { ConfirmPopover } from '../ConfirmPopover/ConfirmPopover.js'
import { Wordmark } from '../Wordmark/Wordmark.js'
import { SkinButton } from './SkinButton.js'
import { copy } from '../../../locale/index.js'
import type { Skin } from '../../../lib/preferences/skin.js'
import { HOLD_RENEW_MS, type AppQuit } from '../../../lib/appQuit.js'
import type { NavigationRun } from '../layerStack/LayerStackContext.js'

export interface AppHeaderProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
  onSettings: () => void
  onAbout: () => void
  /** The desktop app's way to end itself (task 16.2b); none in the browser build, and then no button. */
  quit?: AppQuit | undefined
  /**
   * A whole-list run (Reset, Restore order, an Undo) is going on (H-015): Settings and About, which would open a layer, are disabled and say what
   * they wait for, and Quit asks first, naming the list, because the list is half-done until the run ends.
   */
  run?: NavigationRun | undefined
}

/**
 * The fixed bar at the top of the app (design-system/components/AppHeader):
 * wordmark on the left, the skin button, Settings and About on the right, and
 * on the desktop Quit (macOS) or Exit (Windows) last. Takes no plate — plates
 * belong to layer headers.
 */
export function AppHeader({ skin, onSkinChange, onSettings, onAbout, quit, run }: AppHeaderProps) {
  const wait = run ? { title: copy.quantum.hold.wait[run.kind], disabled: true } : {}

  return (
    <header className="q-appheader">
      <Wordmark />
      <div className="tools">
        <SkinButton skin={skin} onSkinChange={onSkinChange} />
        <IconButton label={copy.quantum.appHeader.settings} onClick={onSettings} {...wait}>
          <Settings width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
        </IconButton>
        <IconButton label={copy.quantum.appHeader.about} onClick={onAbout} {...wait}>
          <Info width={17} height={17} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
        {quit && <QuitButton quit={quit} run={run} />}
      </div>
    </header>
  )
}

/**
 * Asks before ending the app: nothing is lost, but the button sits next to Settings and About. While a whole-list run goes on it says
 * that quitting now can leave that list half-finished (the desktop database has no transactions) and offers to keep waiting.
 */
function QuitButton({ quit, run }: { quit: AppQuit; run: NavigationRun | undefined }) {
  const text = copy.quantum.appHeader.quit
  const words = text[quit.platform]
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const running = run !== undefined
  // Set once the person chose Quit anyway: the run goes on while the window closes, and the renewal must not take the close back.
  const quitting = useRef(false)

  // While a run goes on the window's own close (its button, Cmd+Q, Alt+F4) is held back by the native side, which answers with the same question;
  // the hold is renewed, because the native side lets it lapse if the page stops (a hung page must not make the app impossible to close).
  useEffect(() => {
    if (!running) return
    const hold = () => {
      if (!quitting.current) void quit.holdClose(true).catch(() => {})
    }
    hold()
    const timer = setInterval(hold, HOLD_RENEW_MS)

    return () => {
      clearInterval(timer)
      quitting.current = false
      void quit.holdClose(false).catch(() => {})
    }
  }, [running, quit])

  useEffect(() => {
    let stop: (() => void) | undefined
    let gone = false
    void quit
      .onQuitWhileRunning(() => setAnchor(button.current))
      .then((off) => (gone ? off() : (stop = off)))
      .catch(() => {})

    return () => {
      gone = true
      stop?.()
    }
  }, [quit])

  return (
    <>
      <IconButton ref={button} label={words.action} onClick={(event) => setAnchor(event.currentTarget)}>
        <Power width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
      </IconButton>
      <ConfirmPopover
        open={anchor !== null}
        anchorEl={anchor}
        onDismiss={() => setAnchor(null)}
        width={300}
        kicker={words.action}
        question={run ? text.running.question[quit.platform](run.listName) : words.question}
        note={run ? text.running.note : text.note}
        danger={running}
        focusKeep={running}
        onKeep={() => setAnchor(null)}
        keepLabel={run ? text.running.keep : text.cancel}
        onConfirm={() => {
          setAnchor(null)
          // Let go of the hold first, or the window would hold this close back as well.
          quitting.current = true
          if (running) void quit.holdClose(false).catch(() => {}).then(() => quit.quit())
          else void quit.quit()
        }}
        confirmLabel={run ? text.running.confirm[quit.platform] : words.action}
      />
    </>
  )
}
