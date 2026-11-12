import './SettingsScreen.css'
import { X } from 'lucide-react'
import { isDesktop } from '../../lib/platform.js'
import { ApiKeysSection } from './ApiKeysSection.js'
import { useLanguage } from '../../locale/LanguageProvider.js'
import { copy } from '../../locale/index.js'
import { getPreferencesStore, type PreferencesStore } from '../../lib/preferences/store.js'
import { LANGUAGES, setLanguage as persistLanguage, type Language } from '../../lib/preferences/language.js'
import { SKINS, type Skin } from '../../lib/preferences/skin.js'
import { THEMES, type Theme } from '../../lib/preferences/theme.js'
import { EXZED_SKINS, EXZED_SKIN_NAMES, type ExzedSkin } from '../../lib/preferences/exzedSkins.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { useLiveRegion } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { useMotion } from '../../components/quantum/Motion/MotionContext.js'
import { useGroupLineSetting } from '../../components/quantum/GroupTriangle/GroupTriangle.js'
import { useTimeLeftSetting } from '../../components/quantum/Home/TimeLeftSetting.js'
import { useSpectrumBorder } from '../../components/quantum/DocumentTheme/SpectrumBorderSetting.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import { useWindowFullscreen } from '../../lib/windowFullscreen.js'
import { ExzedSkinSwatch, SkinSwatch } from '../../components/quantum/SkinSwatch/SkinSwatch.js'
import { ToggleChip } from '../../components/quantum/ToggleChip/ToggleChip.js'

export interface SettingsScreenProps {
  /** Quantum's skin, and eX-Zed's own (they are two preferences: switching theme restores each theme's last skin). */
  skin: Skin
  onSkinChange: (skin: Skin) => void
  exzedSkin: ExzedSkin
  onExzedSkinChange: (skin: ExzedSkin) => void
  /** The theme in force, and the shell's switch (49.7): applied at once and stored there; this announces it. */
  theme: Theme
  /** `anchor` is the chip that was pressed: what the narrow-window warning (49.12) opens its popover on. */
  onThemeChange: (theme: Theme, anchor?: HTMLElement) => void
  /** False on a touch-only device (49.10): eX-Zed is not offered there, so the THEME row is not drawn and Quantum's skin row stays. */
  canChooseTheme: boolean
  /** Where the language is remembered; the skin and reduced motion are persisted by their owners. */
  store?: PreferencesStore
}

/**
 * The Settings layer (task 10.30; prototype `isSettings`, plate left seed 5).
 * THEME has two choices, Quantum and eX-Zed (49.8); SKIN shows the skins of the theme in force: Quantum's five with the hexagon, eX-Zed's six with the
 * half-bucket swatch (design X-003). There is no atmosphere control (Q4). The API keys section is desktop only (task 10.31).
 */
export function SettingsScreen({ skin, onSkinChange, exzedSkin, onExzedSkinChange, theme, onThemeChange, canChooseTheme, store }: SettingsScreenProps) {
  const layerStack = useLayerStack()
  const { announce } = useLiveRegion()
  const { language, setLanguage } = useLanguage()
  const { reduced, setReducedMotion } = useMotion()
  const groupLine = useGroupLineSetting()
  const timeLeft = useTimeLeftSetting()
  const spectrumBorder = useSpectrumBorder()
  const fullscreen = useWindowFullscreen()
  const text = copy.quantum.settings

  function pickSkin(next: Skin): void {
    onSkinChange(next)
    announce(copy.quantum.skin.changed(copy.quantum.skin.labels[next]))
  }

  function pickExzedSkin(next: ExzedSkin): void {
    onExzedSkinChange(next)
    announce(copy.quantum.skin.changed(EXZED_SKIN_NAMES[next]))
  }

  // The names of the themes are names: not translated.
  const themeNames: Record<Theme, string> = { quantum: text.themeQuantum, exzed: text.themeExzed }

  function pickTheme(next: Theme, anchor: HTMLElement): void {
    // The lit one is not a switch: nothing to apply, and nothing to announce.
    if (next === theme) return
    onThemeChange(next, anchor)
    announce(text.themeChanged(themeNames[next]))
  }

  function pickLanguage(next: Language): void {
    setLanguage(next)
    void persistLanguage(store ?? getPreferencesStore(), next)
  }

  return (
    <div className="q-settings">
      <div className="q-settings-head">
        <HeaderPlate side="left" seed={5} />
        <h1 className="q-settings-title">{text.title}</h1>
        <IconButton label={text.closeLabel} onClick={() => layerStack.pop()}>
          <X width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="q-settings-body">
        <div className="q-settings-sections">
          {canChooseTheme && (
            <section>
              <span className="q-kicker">{text.theme}</span>
              <div className="q-settings-row">
                {THEMES.map((id) => (
                  <ToggleChip key={id} variant="choice" pressed={id === theme} onClick={(event) => pickTheme(id, event.currentTarget)}>
                    {themeNames[id]}
                  </ToggleChip>
                ))}
              </div>
            </section>
          )}

          <section>
            <span className="q-kicker">{text.skin}</span>
            <div className="q-settings-row">
              {theme === 'exzed'
                ? EXZED_SKINS.map((id) => (
                    <ToggleChip key={id} variant="choice" className="skin" pressed={id === exzedSkin} onClick={() => pickExzedSkin(id)}>
                      <ExzedSkinSwatch skin={id} />
                      {EXZED_SKIN_NAMES[id]}
                    </ToggleChip>
                  ))
                : SKINS.map((id) => (
                    <ToggleChip key={id} variant="choice" className="skin" pressed={id === skin} onClick={() => pickSkin(id)}>
                      <SkinSwatch skin={id} small />
                      {copy.quantum.skin.labels[id]}
                    </ToggleChip>
                  ))}
            </div>
          </section>

          <section>
            <span className="q-kicker">{text.screen}</span>
            {/* Desktop only (17.7): Windows has no full-screen control of its own; F11 does the same. */}
            {fullscreen.available && (
              <label className="q-settings-check">
                <input
                  type="checkbox"
                  checked={fullscreen.fullscreen}
                  onChange={(event) => fullscreen.setFullscreen(event.target.checked)}
                />
                {text.fullscreen}
              </label>
            )}
            <label className="q-settings-check">
              <input type="checkbox" checked={reduced} onChange={(event) => setReducedMotion(event.target.checked)} />
              {text.reduceMotion}
            </label>
            {/* H-022, on every platform (owner, 2026-10-28): the line beside each group's arrow, applied at once. */}
            <Tip as="label" className="q-settings-check" text={text.markOpenGroupsTip}>
              <input
                type="checkbox"
                aria-description={text.markOpenGroupsTip}
                checked={groupLine.on}
                onChange={(event) => groupLine.setOn(event.target.checked)}
              />
              {text.markOpenGroups}
            </Tip>
            {/* H-024 (canvas, owner 2026-10-31): the time left on My Lists, off unless asked for; applied at once. */}
            <Tip as="label" className="q-settings-check" text={text.showTimeLeftTip}>
              <input
                type="checkbox"
                aria-description={text.showTimeLeftTip}
                checked={timeLeft.on}
                onChange={(event) => timeLeft.setOn(event.target.checked)}
              />
              {text.showTimeLeft}
            </Tip>
            {/* X-006, eX-Zed only: the stripes around the app on a screen wider than 2560px, on unless turned off; applied at once. Last in Screen. On Lotus (50.13, design
                answer 12) there is no border at all, so the switch is disabled, keeps the stored choice for the other skins and says why. */}
            {theme === 'exzed' && (
              <Tip as="label" className="q-settings-check" data-disabled={exzedSkin === 'exzed-1l' ? '' : undefined} text={exzedSkin === 'exzed-1l' ? text.spectrumBorderLotusTip : text.spectrumBorderTip}>
                <input
                  type="checkbox"
                  aria-description={exzedSkin === 'exzed-1l' ? text.spectrumBorderLotusTip : text.spectrumBorderTip}
                  checked={spectrumBorder.on}
                  disabled={exzedSkin === 'exzed-1l'}
                  onChange={(event) => spectrumBorder.setOn(event.target.checked)}
                />
                {text.spectrumBorder}
              </Tip>
            )}
          </section>

          <section>
            <span className="q-kicker">{text.language}</span>
            <div className="q-settings-row tight">
              {LANGUAGES.map((id) => (
                <ToggleChip key={id} pressed={id === language} onClick={() => pickLanguage(id)}>
                  {text.languages[id]}
                </ToggleChip>
              ))}
            </div>
          </section>

          {/* Keys live in the server's environment on the web, so the section is not there at all (C7). */}
          {isDesktop() && <ApiKeysSection />}
        </div>
      </div>
    </div>
  )
}
