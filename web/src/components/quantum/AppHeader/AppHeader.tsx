import './AppHeader.css'
import { Info, Settings } from 'lucide-react'
import { IconButton } from '../Button/Button.js'
import { Wordmark } from '../Wordmark/Wordmark.js'
import { SkinButton } from './SkinButton.js'
import { copy } from '../../../locale/index.js'
import type { Skin } from '../../../lib/preferences/skin.js'

export interface AppHeaderProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
  onSettings: () => void
  onAbout: () => void
}

/**
 * The fixed bar at the top of the app (design-system/components/AppHeader):
 * wordmark on the left, the skin button, Settings and About on the right. Takes
 * no plate — plates belong to layer headers.
 */
export function AppHeader({ skin, onSkinChange, onSettings, onAbout }: AppHeaderProps) {
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
      </div>
    </header>
  )
}
