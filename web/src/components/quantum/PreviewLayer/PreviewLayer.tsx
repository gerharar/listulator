import './PreviewLayer.css'
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { formatDuration } from '../../../formatDuration.js'
import { api, type MediaType, type SourcePreview } from '../../../lib/api.js'
import {
  createFromSourceInput,
  groupPreviewRows,
  summarizePreview,
  type PreviewSource,
} from '../../../lib/preview.js'
import { copy, sourceLabel } from '../../../locale/index.js'
import { Button, IconButton } from '../Button/Button.js'
import { ErrorBlock } from '../ErrorBlock/ErrorBlock.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { platformChipLabel } from '../PlatformChip/PlatformChip.js'
import { PreviewRow } from '../PreviewRow/PreviewRow.js'
import { Spinner } from '../Spinner/Spinner.js'
import { StatusChip } from '../StatusChip/StatusChip.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'

const CANONICAL_PREFIX = 'canonical:'

export interface PreviewLayerProps {
  source: PreviewSource
  /** For the category's default runtime, and the source's name. */
  mediaType: MediaType
  /** Called with the new list's id once Add list succeeds. */
  onBuilt: (listId: string) => void
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; preview: SourcePreview }

/**
 * The Preview layer (design: "Preview", task 10.15): the whole candidate list
 * in arrival order, before it exists. The header carries the count and total
 * runtime and puts Add list where the result row has it; Esc or the backdrop
 * returns to the results untouched.
 *
 * Add list sends the very request a result row sends (`createFromSourceInput`),
 * so the two make the same list.
 */
export function PreviewLayer({ source, mediaType, onBuilt }: PreviewLayerProps) {
  const text = copy.quantum.preview
  const layerStack = useLayerStack()

  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setLoad({ state: 'loading' })

    api
      .preview(source.mediaType, source.externalRef, source.options)
      .then((preview) => current && setLoad({ state: 'done', preview }))
      .catch(
        (cause: unknown) =>
          current &&
          setLoad({
            state: 'error',
            message: cause instanceof Error ? cause.message : text.loadFailedHeadline,
          }),
      )

    return () => {
      current = false
    }
    // The source is fixed for a layer's lifetime; only Retry re-runs this.
  }, [attempt])

  const items = load.state === 'done' ? load.preview.items : []
  const rows = useMemo(() => groupPreviewRows(items), [items])
  const summary = summarizePreview(items, mediaType.defaultDurationMinutes)
  // A category whose convention names platforms gets chips, as wide as the widest label (as on the list).
  const platformWidthCh = useMemo(
    () =>
      mediaType.facets?.some((facet) => facet.key === 'platform')
        ? Math.max(5, ...items.map((entry) => platformChipLabel(entry.tags ?? [])?.length ?? 0))
        : undefined,
    [mediaType, items],
  )

  function toggle(label: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  async function add() {
    setAdding(true)
    setAddError(null)

    try {
      const list = await api.createFromSource(createFromSourceInput(source))
      onBuilt(list.id)
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : text.loadFailedHeadline)
      setAdding(false)
    }
  }

  const curated = source.externalRef.startsWith(CANONICAL_PREFIX)
  const provenance = curated
    ? copy.quantum.search.curatedProvenance
    : copy.quantum.search.sourceProvenance(sourceLabel(mediaType) ?? mediaType.label)
  const canAdd = load.state === 'done' && load.preview.items.length > 0

  return (
    <div className="q-preview">
      <div className="q-preview-head">
        <HeaderPlate side="right" seed={4} marks />
        <div className="q-preview-top">
          <div className="q-preview-titles">
            <p className="q-kicker">{text.title}</p>
            <h1 className="q-preview-title">
              {source.title}
              {load.state === 'done' && <StatusChip status={load.preview.status ?? null} />}
            </h1>
            {load.state === 'done' && (
              <p className="q-preview-summary">
                {text.summary(summary.count, formatDuration(summary.minutes), summary.estimated)}
              </p>
            )}
          </div>
          <div className="q-preview-actions">
            <Button
              variant="primary"
              disabled={!canAdd}
              busy={adding}
              busyLabel={text.adding}
              onClick={() => void add()}
            >
              {text.addButton}
            </Button>
            <IconButton label={text.closeLabel} onClick={() => layerStack.pop()}>
              <X width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </div>

      <div className="q-preview-body">
        {load.state === 'loading' && (
          <div className="q-preview-progress">
            <Spinner label={text.loading} />
            <span>{text.loading}</span>
          </div>
        )}
        {load.state === 'error' && (
          <ErrorBlock
            headline={text.loadFailedHeadline}
            explanation={load.message}
            action={{ label: text.retry, onClick: () => setAttempt((count) => count + 1) }}
          />
        )}
        {addError && (
          <ErrorBlock headline={text.loadFailedHeadline} explanation={addError} />
        )}
        {load.state === 'done' && load.preview.items.length === 0 && (
          <ErrorBlock headline={text.nothingToAdd} />
        )}
        {load.state === 'done' &&
          rows.map((row, index) => {
            if (row.kind === 'group') {
              const isCollapsed = collapsed.has(row.label)

              return (
                <button
                  key={`g${index}`}
                  type="button"
                  className="q-preview-group"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? text.expandGroup(row.label) : text.collapseGroup(row.label)}
                  onClick={() => toggle(row.label)}
                >
                  {/* One glyph, turned a quarter in CSS when folded: the list screen's group rows and the design's PreviewRow do the same. */}
                  <span className="q-chev" aria-hidden="true">
                    ▼
                  </span>
                  <span className="name">{row.label}</span>
                  <span className="count">{row.count}</span>
                </button>
              )
            }

            // A row inside a collapsed group is hidden, wherever that group's head is.
            if (row.item.group !== undefined && collapsed.has(row.item.group)) return null

            return (
              <PreviewRow
                key={`i${index}`}
                item={row.item}
                grouped={row.grouped}
                facets={mediaType.facets}
                platformWidthCh={platformWidthCh}
              />
            )
          })}
      </div>

      <p className="q-preview-footer t-small">{text.footer(provenance)}</p>
    </div>
  )
}
