import { copy } from '../../../locale/index.js'
import type { LayerDescriptor } from './layerStack.js'

/**
 * A list's layer when its title is not to hand (just created, so nothing has
 * fetched it): a generic tab label until the layer's own screen knows better.
 */
export function untitledListLayer(listId: string): LayerDescriptor<string> {
  return {
    id: `list-${listId}`,
    kind: 'list',
    tabLabel: copy.quantum.layerStack.untitledListTab,
    content: `/lists/${listId}`,
  }
}
