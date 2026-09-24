import './AppHeader.css'
import { Settings } from 'lucide-react'
import { IconButton } from '../Button/Button.js'
import { Wordmark } from '../Wordmark/Wordmark.js'
import { SkinButton } from './SkinButton.js'
import { copy } from '../../../locale/index.js'
import type { Skin } from '../../../lib/preferences/skin.js'

export interface AppHeaderProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
}

/**
 * The fixed bar at the top of the app (design-system/components/AppHeader):
 * wordmark on the left, the skin button and Settings on the right. Takes
 * no plate — plates belong to layer headers.
 *
 * Settings is disabled with a `title` until task 10.30 builds the
 * Settings layer, same convention 10.10's help row uses for its own
 * not-yet-built buttons.
 */
export function AppHeader({ skin, onSkinChange }: AppHeaderProps) {
  return (
    <header className="q-appheader">
      <Wordmark />
      <div className="tools">
        <SkinButton skin={skin} onSkinChange={onSkinChange} />
        <IconButton
          label={copy.quantum.appHeader.settings}
          title={copy.quantum.appHeader.settingsComingSoon}
          disabled
        >
          <Settings width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  )
}
