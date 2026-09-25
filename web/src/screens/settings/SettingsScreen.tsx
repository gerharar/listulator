import './SettingsScreen.css'
import { X } from 'lucide-react'
import { useLanguage } from '../../locale/LanguageProvider.js'
import { copy } from '../../locale/index.js'
import { getPreferencesStore, type PreferencesStore } from '../../lib/preferences/store.js'
import { LANGUAGES, setLanguage as persistLanguage, type Language } from '../../lib/preferences/language.js'
import { MOTIONS } from '../../lib/preferences/motion.js'
import { SKINS, type Skin } from '../../lib/preferences/skin.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { useLiveRegion } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { useMotion } from '../../components/quantum/Motion/MotionContext.js'
import { ToggleChip } from '../../components/quantum/ToggleChip/ToggleChip.js'

export interface SettingsScreenProps {
  skin: Skin
  onSkinChange: (skin: Skin) => void
  /** Where the language is remembered; the skin and motion are persisted by their owners. */
  store?: PreferencesStore
}

/**
 * The Settings layer (task 10.30; prototype `isSettings`, plate left seed 5).
 * Theme is Quantum only and lit — the prototype's other themes are not part of
 * this app — and there is no atmosphere control (Q4). The API keys section is
 * task 10.31 (desktop only).
 */
export function SettingsScreen({ skin, onSkinChange, store }: SettingsScreenProps) {
  const layerStack = useLayerStack()
  const { announce } = useLiveRegion()
  const { language, setLanguage } = useLanguage()
  const { motion, reduced, setMotion, setReducedMotion } = useMotion()
  const text = copy.quantum.settings

  function pickSkin(next: Skin): void {
    onSkinChange(next)
    announce(copy.quantum.skin.changed(copy.quantum.skin.labels[next]))
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
          <section>
            <span className="q-kicker">{text.theme}</span>
            <div className="q-settings-row">
              <ToggleChip variant="choice" pressed>
                {text.themeQuantum}
              </ToggleChip>
            </div>
          </section>

          <section>
            <span className="q-kicker">{text.skin}</span>
            <div className="q-settings-row">
              {SKINS.map((id) => (
                <ToggleChip key={id} variant="choice" className="skin" pressed={id === skin} onClick={() => pickSkin(id)}>
                  <span className="q-swatch-sq" data-theme={id} aria-hidden="true" />
                  {copy.quantum.skin.labels[id]}
                </ToggleChip>
              ))}
            </div>
          </section>

          <section>
            <span className="q-kicker">{text.motion}</span>
            <div className="q-settings-row">
              {MOTIONS.map((id) => (
                <ToggleChip key={id} variant="choice" pressed={id === motion} onClick={() => setMotion(id)}>
                  {text.motions[id]}
                </ToggleChip>
              ))}
            </div>
            <label className="q-settings-check">
              <input type="checkbox" checked={reduced} onChange={(event) => setReducedMotion(event.target.checked)} />
              {text.reduceMotion}
            </label>
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
        </div>
      </div>
    </div>
  )
}
