import { useState } from 'react'
import { api } from '../lib/api.js'
import { copy } from '../locale/index.js'

/**
 * Imports a whole list from a pasted or uploaded custom-list YAML file
 * (task 7.2, `docs/intent/custom-lists.md`). The file carries its own title
 * and category, so this is independent of the category picker above it on
 * the page — one shared textarea either way: choosing a file just reads its
 * text into the same box, so there is one submit action, not two.
 */
export function CustomListImport({ onImported }: { onImported: (listId: string) => void }) {
  const [yaml, setYaml] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clears the control so choosing the same file again still fires a change.
    event.target.value = ''
    if (!file) return

    setYaml(await file.text())
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!yaml.trim()) return

    setImporting(true)
    setError(null)

    try {
      const list = await api.createFromFile({ yaml })
      onImported(list.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.customListImport.importFailed)
      setImporting(false)
    }
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">{copy.customListImport.heading}</h2>
      </header>

      <form className="panel" onSubmit={(event) => void submit(event)}>
        <div style={{ padding: 'var(--space-4)' }}>
          <p className="field__hint">{copy.customListImport.hint}</p>

          <label className="field">
            <span className="field__label">{copy.customListImport.chooseFileLabel}</span>
            <input
              className="input"
              type="file"
              accept=".yaml,.yml,text/yaml"
              onChange={(event) => void handleFile(event)}
            />
          </label>

          <label className="field">
            <span className="field__label">{copy.customListImport.pasteLabel}</span>
            <textarea
              className="textarea"
              value={yaml}
              onChange={(event) => setYaml(event.target.value)}
              placeholder={copy.customListImport.pastePlaceholder}
            />
          </label>

          {error && <p className="notice notice--error">{error}</p>}

          <button className="button" type="submit" disabled={importing || !yaml.trim()}>
            {importing ? copy.customListImport.importing : copy.customListImport.import}
          </button>
        </div>
      </form>
    </section>
  )
}
