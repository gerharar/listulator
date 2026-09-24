import './ImportFileTab.css'
import { useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { Info } from 'lucide-react'
import { api } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { FieldTextArea, ReadOnlyBuffer } from '../Field/Field.js'

export interface ImportFileTabProps {
  /** Called with the new list's id once the import succeeds. */
  onBuilt: (listId: string) => void
}

const lineCount = (text: string): number => text.replace(/\n$/, '').split('\n').length

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`
}

/**
 * The Create layer's Import-a-file tab (design: "Import a file", task 10.14):
 * one YAML file describing one list, by *Choose file…* or by paste, and a
 * single Import.
 *
 * Nothing is checked until Import: the read-out is a fact about the text at
 * the moment it arrived and is never recomputed, and a refusal is one
 * sentence that clears on the next edit or file pick. The buffer lives only
 * in this component, so leaving the tab (which unmounts it) clears it.
 * The server parses the file, and stores the raw text as `source_yaml` so the
 * list can be Reset later.
 */
export function ImportFileTab({ onBuilt }: ImportFileTabProps) {
  const text = copy.quantum.importFile

  const [yaml, setYaml] = useState('')
  const [readOut, setReadOut] = useState<string | null>(null)
  // Bumped per chosen file, so a second pick remounts the buffer read-only.
  const [fileSeq, setFileSeq] = useState(0)
  const [importing, setImporting] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clears the control so choosing the same file again still fires a change.
    event.target.value = ''
    if (!file) return

    const contents = await file.text()

    setYaml(contents)
    setReadOut(
      text.readOutFile(file.name, formatSize(file.size), text.lines(lineCount(contents))),
    )
    setFileSeq((current) => current + 1)
    setRefusal(null)
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    setReadOut(text.readOutPasted(text.lines(lineCount(event.clipboardData.getData('text')))))
  }

  function edit(value: string) {
    setYaml(value)
    setRefusal(null)
  }

  async function submit() {
    if (importing || !yaml.trim()) return
    setImporting(true)
    setRefusal(null)

    try {
      const list = await api.createFromFile({ yaml })
      onBuilt(list.id)
    } catch (cause) {
      setRefusal(cause instanceof Error ? cause.message : text.importFailed)
      setImporting(false)
    }
  }

  return (
    <div className="q-import">
      <div className="q-import-pick">
        <Button disabled={importing} onClick={() => picker.current?.click()}>
          {text.chooseFile}
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".yaml,.yml,text/yaml"
          hidden
          onChange={(event) => void pickFile(event)}
        />
        {readOut && <span className="q-import-readout">{readOut}</span>}
      </div>

      {fileSeq > 0 ? (
        <ReadOnlyBuffer
          key={fileSeq}
          label={text.boxLabel}
          value={yaml}
          onChange={edit}
          rows={10}
          code
          locked={importing}
        />
      ) : (
        <FieldTextArea
          label={text.boxLabel}
          value={yaml}
          onChange={(event) => edit(event.target.value)}
          onPaste={paste}
          placeholder={text.boxPlaceholder}
          rows={10}
          code
          readOnly={importing}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      )}

      <div className="q-import-actions">
        {refusal && (
          <p className="q-import-refusal" role="status">
            <Info width={15} height={15} aria-hidden="true" />
            {refusal}
          </p>
        )}
        <Button
          variant="primary"
          disabled={!yaml.trim()}
          busy={importing}
          busyLabel={text.importing}
          onClick={() => void submit()}
        >
          {text.import}
        </Button>
      </div>

      <p className="q-import-footer t-small">{text.footer}</p>
    </div>
  )
}
