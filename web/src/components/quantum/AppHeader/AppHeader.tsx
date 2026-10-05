import './AppHeader.css'
import { useState } from 'react'
import { Info, Power, Settings } from 'lucide-react'
import { IconButton } from '../Button/Button.js'
import { ConfirmPopover } from '../ConfirmPopover/ConfirmPopover.js'
import { Wordmark } from '../Wordmark/Wordmark.js'
import { SkinButton } from './SkinButton.js'
import { copy } from '../../../locale/index.js'
import type { Skin } from '../../../lib/preferences/skin.js'
import type { AppQuit } from '../../../lib/appQuit.js'

export interface AppHeaderProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
  onSettings: () => void
  onAbout: () => void
  /** The desktop app's way to end itself (task 16.2b); none in the browser build, and then no button. */
  quit?: AppQuit | undefined
}

/**
 * The fixed bar at the top of the app (design-system/components/AppHeader):
 * wordmark on the left, the skin button, Settings and About on the right, and
 * on the desktop Quit (macOS) or Exit (Windows) last. Takes no plate — plates
 * belong to layer headers.
 */
export function AppHeader({ skin, onSkinChange, onSettings, onAbout, quit }: AppHeaderProps) {
  return (
    <header className="q-appheader">
      <Wordmark />
      <div className="tools">
        <SkinButton skin={skin} onSkinChange={onSkinChange} />
        <IconButton label={copy.quantum.appHeader.settings} onClick={onSettings}>
          <Settings width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
        </IconButton>
        <IconButton label={copy.quantum.appHeader.about} onClick={onAbout}>
          <Info width={17} height={17} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
        {quit && <QuitButton quit={quit} />}
      </div>
    </header>
  )
}

/** Asks before ending the app: nothing is lost, but the button sits next to Settings and About. */
function QuitButton({ quit }: { quit: AppQuit }) {
  const text = copy.quantum.appHeader.quit
  const words = text[quit.platform]
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  return (
    <>
      <IconButton label={words.action} onClick={(event) => setAnchor(event.currentTarget)}>
        <Power width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
      </IconButton>
      <ConfirmPopover
        open={anchor !== null}
        anchorEl={anchor}
        onDismiss={() => setAnchor(null)}
        width={300}
        kicker={words.action}
        question={words.question}
        note={text.note}
        onKeep={() => setAnchor(null)}
        keepLabel={text.cancel}
        onConfirm={() => {
          setAnchor(null)
          void quit.quit()
        }}
        confirmLabel={words.action}
      />
    </>
  )
}
