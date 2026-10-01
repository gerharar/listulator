import './CreateList.css'
import { useState } from 'react'
import { untitledListLayer } from '../layerStack/listLayer.js'
import { X } from 'lucide-react'
import type { MediaType } from '../../../lib/api.js'
import { categoryDescription, categoryLabel, copy, sourceLabel } from '../../../locale/index.js'
import { AddByHandTab } from '../AddByHandTab/AddByHandTab.js'
import { IconButton } from '../Button/Button.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { ImportFileTab } from '../ImportFileTab/ImportFileTab.js'
import { SearchTab } from '../SearchTab/SearchTab.js'
import { useLayerStack } from '../layerStack/LayerStackContext.js'
import { TabStrip, type TabStripTab } from '../TabStrip/TabStrip.js'

type TabKey = 'search' | 'hand' | 'import'

export interface CreateListProps {
  /** The live registry, lifted up from Home (task 10.10). */
  mediaTypes: readonly MediaType[]
  /** The category the picker chose. A key the registry lacks falls back to the first entry. */
  mediaTypeKey: string
  /** A search to run when the layer opens, and the result to open once it answers (Open in Mega, task 14.1). */
  initialQuery?: string
  initialOpen?: string
}

/**
 * The Create layer (design: "New {Category} list", task 10.12): the chosen
 * category's header, and a TabStrip on its rule for the three ways to fill a
 * list — search a source, add by hand, import a file. The category is fixed
 * here; changing it means going back to the picker.
 *
 * Only the active tab is mounted, so leaving one clears whatever transient
 * state it held (the design's rule: "the Import buffer never survives a
 * leave"). Building a list lands on it: the stack collapses to Home and the list.
 */
export function CreateList({ mediaTypes, mediaTypeKey, initialQuery, initialOpen }: CreateListProps) {
  const layerStack = useLayerStack()
  const mediaType = mediaTypes.find((entry) => entry.key === mediaTypeKey) ?? mediaTypes[0]

  // A category with a search source keeps its Search tab even when the source
  // is unavailable (no key), so the tab can say so instead of vanishing.
  const source = mediaType ? sourceLabel(mediaType) : undefined
  const hasSearch = Boolean(source)
  const text = copy.quantum.createList

  const tabs: TabStripTab[] = [
    ...(source ? [{ key: 'search', label: text.searchTab(source) }] : []),
    { key: 'hand', label: text.handTab },
    { key: 'import', label: text.importTab },
  ]
  const [active, setActive] = useState<TabKey>(hasSearch ? 'search' : 'hand')

  const description = mediaType ? categoryDescription(mediaType) : undefined
  const built = (listId: string) => layerStack.landOnList(untitledListLayer(listId))

  return (
    <div className="q-create">
      <div className="q-create-head">
        <HeaderPlate side="right" seed={3} />
        <div className="q-create-top">
          <div className="q-create-titles">
            <h1 className="q-create-title">
              {text.title(mediaType ? categoryLabel(mediaType) : '')}
            </h1>
            {description && <p className="q-create-sub">{description}</p>}
          </div>
          <IconButton label={text.closeLabel} onClick={() => layerStack.pop()}>
            <X width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
          </IconButton>
        </div>
        <TabStrip tabs={tabs} active={active} onChange={(key) => setActive(key as TabKey)} />
      </div>

      <div className="q-create-body">
        {active === 'search' && mediaType && (
          <SearchTab
            mediaType={mediaType}
            onBuilt={built}
            {...(initialQuery ? { initialQuery } : {})}
            {...(initialOpen ? { initialOpen } : {})}
          />
        )}
        {active === 'hand' && mediaType && <AddByHandTab mediaType={mediaType} onBuilt={built} />}
        {active === 'import' && mediaType && (
          <ImportFileTab mediaTypes={mediaTypes} mediaTypeKey={mediaType.key} onBuilt={built} />
        )}
      </div>
    </div>
  )
}
