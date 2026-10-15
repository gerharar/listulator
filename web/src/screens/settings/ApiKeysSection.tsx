import './ApiKeysSection.css'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Info } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { getLocalSettings, updateLocalSettings, type LocalSettings } from '../../lib/config/localConfig.js'
import type { KeySource, KeyTestResult } from '../../lib/config/keyTest.js'
import { resetLocalMediaTypes } from '../../lib/ingestion/localMediaTypes.js'
import { notifyRegistryChanged } from '../../lib/registryChanges.js'
import { testApiKey } from '../../lib/api.local.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { MaskedKey } from '../../components/quantum/Field/Field.js'
import { useFieldValidation } from '../../components/quantum/Field/useFieldValidation.js'
import { ExternalLink, type ExternalLinkProps } from '../../components/quantum/ExternalLink/ExternalLink.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import { useTooltip } from '../../components/quantum/Tooltip/useTooltip.js'
import { keyGuideUrl } from '../../lib/guides.js'

/** Which saved settings make up each source's key (IGDB needs an ID and a secret). */
const SOURCES: readonly { id: KeySource; fields: readonly (keyof LocalSettings)[] }[] = [
  { id: 'tmdb', fields: ['tmdbApiKey'] },
  { id: 'igdb', fields: ['igdbClientId', 'igdbClientSecret'] },
  { id: 'comicVine', fields: ['comicVineApiKey'] },
  { id: 'youtube', fields: ['youtubeApiKey'] },
]

type Status = 'untested' | 'testing' | KeyTestResult

export interface ApiKeysSectionProps {
  load?: () => Promise<LocalSettings>
  /** Writes the changed fields where the desktop app keeps them, and makes the search sources read them again. */
  save?: (patch: Partial<LocalSettings>) => Promise<void>
  test?: (source: KeySource, values: LocalSettings) => Promise<KeyTestResult>
}

/** Saves the changed key fields, rebuilds the search sources from them, and tells the app to ask them again (16.5). */
export async function saveAndReload(patch: Partial<LocalSettings>): Promise<void> {
  await updateLocalSettings(patch)
  resetLocalMediaTypes()
  notifyRegistryChanged()
}

interface OpenPopover {
  id: KeySource
  /**
   * `how` (the steps, in `copy…keys.sources[…].steps`) is not opened by anything:
   * "How?" is a link to the guide on GitHub for now (owner, 2026-10-02). The popover
   * and its text stay until the guides are settled, then one of them goes.
   */
  mode: 'info' | 'how'
  anchor: HTMLElement
}

/** "How?": a quiet button that leaves the app, so it carries the ↗ every outbound link here does. */
function HowLink({ href, label, title }: { href: string; label: string; title: string }) {
  const tip = useTooltip(title)
  const own: ExternalLinkProps = { href, className: 'q-btn quiet', 'aria-description': title }

  return (
    <>
      <ExternalLink {...tip.props(own)}>
        {label}
        <span aria-hidden="true">↗</span>
      </ExternalLink>
      {tip.node}
    </>
  )
}

interface KeyRowProps {
  id: KeySource
  fields: readonly (keyof LocalSettings)[]
  values: LocalSettings
  current: Status
  onEdit: (field: keyof LocalSettings, value: string) => void
  onInfo: (anchor: HTMLElement) => void
  onTest: () => void
}

/**
 * One source's row. Test is never disabled by an empty field (H-006), only while a test runs: pressing it with a field
 * empty tests nothing and says what is missing, once for the row ("Paste the Client ID first"), marks every empty field
 * and puts the cursor in the first. Typing takes the sentence away.
 */
function KeyRow({ id, fields, values, current, onEdit, onInfo, onTest }: KeyRowProps) {
  const text = copy.quantum.settings.keys
  const source = text.sources[id]
  const empty = (field: keyof LocalSettings): boolean => (values[field] ?? '').trim() === ''
  const missing = fields.filter(empty)
  const sentence =
    fields.length === 1
      ? text.pasteKey
      : missing.length === fields.length
        ? text.pasteBoth
        : missing[0] === fields[0]
          ? text.pasteClientId
          : text.pasteClientSecret
  const checks = useFieldValidation(
    Object.fromEntries(fields.map((field) => [field, { value: values[field] ?? '', problem: () => (empty(field) ? sentence : null) }])),
  )
  // One sentence for the row, under the first empty field; every empty field points at it.
  const shown = fields.find((field) => checks.error(field) !== null)
  const describedBy = shown ? checks.props(shown)['aria-describedby'] : undefined

  return (
    <div className="q-key-row">
      <div className="q-key-head">
        <span className="q-key-name">{source.name}</span>
        <Tip
          as="button"
          type="button"
          className="q-key-info"
          aria-label={text.infoLabel}
          text={text.infoLabel}
          onClick={(event) => onInfo(event.currentTarget)}
        >
          <Info size={14} strokeWidth={1.8} aria-hidden="true" />
        </Tip>
      </div>
      <div className="q-key-fields">
        {fields.map((field, index) => (
          <MaskedKey
            key={field}
            value={values[field] ?? ''}
            onChange={(value) => onEdit(field, value)}
            placeholder={
              fields.length === 1 ? text.placeholder : index === 0 ? text.clientIdPlaceholder : text.clientSecretPlaceholder
            }
            autoComplete="off"
            spellCheck={false}
            {...checks.props(field)}
            {...(checks.error(field) !== null ? { 'aria-describedby': describedBy } : {})}
          />
        ))}
      </div>
      <HowLink href={keyGuideUrl(id)} label={text.how} title={text.howTitle} />
      <Button disabled={current === 'testing'} onClick={() => checks.validate() && onTest()}>
        {text.test}
      </Button>
      <span className={`q-key-pill ${current}`} role="status">
        {text.status[current]}
      </span>
      {shown && checks.message(shown)}
    </div>
  )
}

/**
 * Settings' API keys section (task 10.31; prototype `keys`). Desktop only —
 * `SettingsScreen` does not render it on the web, where keys live in the
 * server's environment. A key is saved as it is typed and takes effect at
 * once; Test sends it to its own provider and shows one word, never the key.
 */
export function ApiKeysSection({
  load = getLocalSettings,
  save = saveAndReload,
  test = testApiKey,
}: ApiKeysSectionProps) {
  const text = copy.quantum.settings.keys
  const [values, setValues] = useState<LocalSettings | null>(null)
  const [status, setStatus] = useState<Partial<Record<KeySource, Status>>>({})
  const [popover, setPopover] = useState<OpenPopover | null>(null)
  /** Bumped by every edit, so a slow test for an earlier value cannot label a newer one. */
  const edits = useRef<Partial<Record<KeySource, number>>>({})

  useEffect(() => {
    let cancelled = false
    void load().then((saved) => {
      if (!cancelled) setValues(saved)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  if (!values) return null

  function edit(source: KeySource, field: keyof LocalSettings, value: string): void {
    edits.current[source] = (edits.current[source] ?? 0) + 1
    setValues((current) => ({ ...current, [field]: value }))
    setStatus((current) => ({ ...current, [source]: 'untested' }))
    void save({ [field]: value })
  }

  async function run(source: KeySource, fields: readonly (keyof LocalSettings)[]): Promise<void> {
    const version = edits.current[source] ?? 0
    setStatus((current) => ({ ...current, [source]: 'testing' }))
    const result = await test(source, Object.fromEntries(fields.map((field) => [field, values?.[field] ?? ''])))
    if ((edits.current[source] ?? 0) !== version) return
    setStatus((current) => ({ ...current, [source]: result }))
  }

  const open = popover
  const openSource = open ? copy.quantum.settings.keys.sources[open.id] : null

  // Every pill is as wide as this language's longest status label, so Test never shifts what follows it.
  const pillChars = Math.max(...Object.values(text.status).map((label) => label.length))

  return (
    <section>
      <span className="q-kicker">{text.title}</span>
      <div className="q-key-rows" style={{ '--pill-chars': pillChars } as CSSProperties}>
        {SOURCES.map(({ id, fields }) => (
          <KeyRow
            key={id}
            id={id}
            fields={fields}
            values={values}
            current={status[id] ?? 'untested'}
            onEdit={(field, value) => edit(id, field, value)}
            onInfo={(anchor) => setPopover({ id, mode: 'info', anchor })}
            onTest={() => void run(id, fields)}
          />
        ))}
      </div>

      <Popover
        open={open !== null}
        anchorEl={open?.anchor ?? null}
        onDismiss={() => setPopover(null)}
        width={300}
      >
        {open && openSource && (
          <div className="q-key-pop">
            {open.mode === 'info' ? (
              <>
                <strong>{openSource.fullName}</strong>
                <span>{text.usedNote(openSource.used)}</span>
                <span className="dim">{text.missNote}</span>
                <span className="dim">{text.storedNote}</span>
              </>
            ) : (
              <>
                <strong>{text.howHeading}</strong>
                <span className="host">{openSource.host}</span>
                <ol>
                  {openSource.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </Popover>
    </section>
  )
}
