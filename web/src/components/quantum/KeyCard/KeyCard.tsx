import './KeyCard.css'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { copy } from '../../../locale/index.js'
import type { LocalSettings } from '../../../lib/config/localConfig.js'
import type { KeySource } from '../../../lib/config/keyTest.js'
import { keyGuideUrl } from '../../../lib/guides.js'
import { saveAndReload, SOURCES } from '../../../screens/settings/ApiKeysSection.js'
import { Button } from '../Button/Button.js'
import { ExternalLink } from '../ExternalLink/ExternalLink.js'
import { MaskedKey } from '../Field/Field.js'
import { useFieldValidation } from '../Field/useFieldValidation.js'
import { useToast } from '../Toast/Toast.js'

export interface KeyCardProps {
  source: KeySource
  /** "One free TMDB key unlocks four categories", "Search in IGDB needs a free API key": it depends on where the card stands. */
  title: string
  /** The sentence or two under the title. */
  children: ReactNode
  /** Where the key goes; Settings' own save by default, which also tells the app so its search sources read it again. */
  save?: (patch: Partial<LocalSettings>) => Promise<void>
  /** Called once the key is saved, after the toast. The card has gone by then. */
  onSaved?: () => void
}

/**
 * The key card (H-018): the key field or fields of one search source, Save Key, and the guide to getting one. The same component stands on
 * the first-run screen and in Create → Search. A key is stored exactly as Settings stores it (its status there is Untested until tested).
 * Nothing about the key itself ever reaches the toast, the screen reader's live region or an error message.
 */
export function KeyCard({ source, title, children, save = saveAndReload, onSaved }: KeyCardProps) {
  const text = copy.quantum.keyCard
  const keys = copy.quantum.settings.keys
  const fields = SOURCES.find((candidate) => candidate.id === source)!.fields
  const [values, setValues] = useState<Partial<Record<keyof LocalSettings, string>>>({})
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const saving = useRef(false)
  const { showToast } = useToast()

  const empty = (field: keyof LocalSettings): boolean => (values[field] ?? '').trim() === ''
  const missing = fields.filter(empty)
  // One sentence for the card, under the row; every empty field points at it (as in Settings' row).
  const sentence =
    fields.length === 1
      ? keys.pasteKey
      : missing.length === fields.length
        ? keys.pasteBoth
        : missing[0] === fields[0]
          ? keys.pasteClientId
          : keys.pasteClientSecret
  const checks = useFieldValidation(
    Object.fromEntries(fields.map((field) => [field, { value: values[field] ?? '', problem: () => (empty(field) ? sentence : null) }])),
  )
  const shown = fields.find((field) => checks.error(field) !== null)
  const describedBy = shown ? checks.props(shown)['aria-describedby'] : undefined

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving.current || !checks.validate()) return
    saving.current = true
    setFailed(false)
    try {
      await save(Object.fromEntries(fields.map((field) => [field, (values[field] ?? '').trim()])))
    } catch {
      saving.current = false
      setFailed(true)

      return
    }
    setSaved(true)
    showToast({ text: text.saved(keys.sources[source].name) })
    onSaved?.()
  }

  if (saved) return null

  return (
    <form className="q-keycard" noValidate onSubmit={(event) => void onSubmit(event)}>
      <b className="q-keycard-title">{title}</b>
      <p className="q-keycard-body">{children}</p>
      <div className="q-keycard-row">
        {fields.map((field, index) => (
          <span key={field} className={fields.length === 1 ? 'q-keycard-field one' : 'q-keycard-field'}>
            <MaskedKey
              value={values[field] ?? ''}
              onChange={(value) => setValues((current) => ({ ...current, [field]: value }))}
              placeholder={fields.length === 1 ? keys.placeholder : index === 0 ? keys.clientIdPlaceholder : keys.clientSecretPlaceholder}
              autoComplete="off"
              spellCheck={false}
              {...checks.props(field)}
              {...(checks.error(field) !== null ? { 'aria-describedby': describedBy } : {})}
            />
          </span>
        ))}
        <Button type="submit" variant="primary">
          {text.saveKey}
        </Button>
        <ExternalLink className="q-keycard-link" href={keyGuideUrl(source)}>
          {text.how}
          <span aria-hidden="true"> ↗</span>
        </ExternalLink>
      </div>
      {shown && checks.message(shown)}
      {failed && (
        <p className="q-keycard-failed" role="alert">
          {text.saveFailed}
        </p>
      )}
    </form>
  )
}
