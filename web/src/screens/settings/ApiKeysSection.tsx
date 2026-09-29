import './ApiKeysSection.css'
import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { getLocalSettings, updateLocalSettings, type LocalSettings } from '../../lib/config/localConfig.js'
import type { KeySource, KeyTestResult } from '../../lib/config/keyTest.js'
import { resetLocalMediaTypes } from '../../lib/ingestion/localMediaTypes.js'
import { testApiKey } from '../../lib/api.local.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { MaskedKey } from '../../components/quantum/Field/Field.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'

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

async function saveAndReload(patch: Partial<LocalSettings>): Promise<void> {
  await updateLocalSettings(patch)
  resetLocalMediaTypes()
}

interface OpenPopover {
  id: KeySource
  mode: 'info' | 'how'
  anchor: HTMLElement
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

  return (
    <section>
      <span className="q-kicker">{text.title}</span>
      <div className="q-key-rows">
        {SOURCES.map(({ id, fields }) => {
          const source = text.sources[id]
          const current = status[id] ?? 'untested'
          const filled = fields.every((field) => (values[field] ?? '').trim() !== '')

          return (
            <div key={id} className="q-key-row">
              <div className="q-key-head">
                <span className="q-key-name">{source.name}</span>
                <button
                  type="button"
                  className="q-key-info"
                  aria-label={text.infoLabel}
                  title={text.infoLabel}
                  onClick={(event) => setPopover({ id, mode: 'info', anchor: event.currentTarget })}
                >
                  <Info size={14} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
              <div className="q-key-fields">
                {fields.map((field, index) => (
                  <MaskedKey
                    key={field}
                    value={values[field] ?? ''}
                    onChange={(value) => edit(id, field, value)}
                    placeholder={
                      fields.length === 1
                        ? text.placeholder
                        : index === 0
                          ? text.clientIdPlaceholder
                          : text.clientSecretPlaceholder
                    }
                    autoComplete="off"
                    spellCheck={false}
                  />
                ))}
              </div>
              <Button
                variant="quiet"
                title={text.howTitle}
                onClick={(event) => setPopover({ id, mode: 'how', anchor: event.currentTarget })}
              >
                {text.how}
              </Button>
              <Button disabled={!filled || current === 'testing'} onClick={() => void run(id, fields)}>
                {text.test}
              </Button>
              <span className={`q-key-pill ${current}`} role="status">
                {text.status[current]}
              </span>
            </div>
          )
        })}
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
