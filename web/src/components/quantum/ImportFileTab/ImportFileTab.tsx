import './ImportFileTab.css'
import { useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { Info } from 'lucide-react'
import { load } from 'js-yaml'
import { api, type MediaType } from '../../../lib/api.js'
import { categoryLabel, copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { ConfirmPopover } from '../ConfirmPopover/ConfirmPopover.js'
import { RichSentence } from '../RichSentence/RichSentence.js'
import { FieldTextArea, ReadOnlyBuffer } from '../Field/Field.js'

export interface ImportFileTabProps {
  /** The registry, to name the category a file belongs to. */
  mediaTypes: readonly MediaType[]
  /** The category this Create screen is for. */
  mediaTypeKey: string
  /** Called with the new list's id once the import succeeds. */
  onBuilt: (listId: string) => void
}

const lineCount = (text: string): number => text.replace(/\n$/, '').split('\n').length

/**
 * The registry key the file names as its `category`, or undefined when the
 * text does not parse or names none. Only a peek to ask the right question:
 * the server still parses and validates the file on Import.
 */
export function peekCategory(yaml: string): string | undefined {
  try {
    const document = load(yaml)
    if (document && typeof document === 'object' && 'category' in document) {
      const { category } = document as { category: unknown }
      return typeof category === 'string' ? category : undefined
    }
  } catch {
    // Unreadable text: the server's refusal says why.
  }
  return undefined
}

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
 *
 * The file names its own category, and that wins over the screen's: a Movies
 * file imported from Create → Games becomes a Movies list, after a question
 * naming both categories (U3, owner's ruling). A file whose category cannot be
 * read, or is not in the registry, goes straight to the server to be refused.
 */
export function ImportFileTab({ mediaTypes, mediaTypeKey, onBuilt }: ImportFileTabProps) {
  const text = copy.quantum.importFile
  // The category the file names when it differs from the screen's: Import asks first.
  const [elsewhere, setElsewhere] = useState<{ mediaType: MediaType; anchor: HTMLElement } | null>(
    null,
  )

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

  function requestImport(anchor: HTMLElement) {
    if (importing || !yaml.trim()) return
    const key = peekCategory(yaml)
    const landed = key === mediaTypeKey ? undefined : mediaTypes.find((entry) => entry.key === key)
    if (landed) setElsewhere({ mediaType: landed, anchor })
    else void submit()
  }

  async function submit() {
    setElsewhere(null)
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

      {/* Prototype: the hint on the left, Import on the right, one row; a refusal under it. */}
      <div className="q-import-actions">
        <p className="q-import-footer t-small">{text.footer}</p>
        <Button
          variant="primary"
          disabled={!yaml.trim()}
          busy={importing}
          busyLabel={text.importing}
          onClick={(event) => requestImport(event.currentTarget)}
        >
          {text.import}
        </Button>
      </div>

      <ConfirmPopover
        open={elsewhere !== null}
        anchorEl={elsewhere?.anchor ?? null}
        onDismiss={() => setElsewhere(null)}
        width={320}
        kicker={text.otherCategoryKicker}
        question={elsewhere ? text.otherCategoryQuestion(categoryLabel(elsewhere.mediaType)) : ''}
        note={
          elsewhere && (
            <RichSentence
              parts={text.otherCategoryNote(
                categoryLabel(
                  mediaTypes.find((entry) => entry.key === mediaTypeKey) ?? elsewhere.mediaType,
                ),
                categoryLabel(elsewhere.mediaType),
              )}
            />
          )
        }
        onKeep={() => setElsewhere(null)}
        keepLabel={text.back}
        onConfirm={() => void submit()}
        confirmLabel={text.import}
      />

      {refusal && (
        <p className="q-import-refusal" role="status">
          <Info width={15} height={15} aria-hidden="true" />
          {refusal}
        </p>
      )}
    </div>
  )
}
