import { useRef } from 'react'
import { useLayerStack } from './LayerStackContext.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'
import { copy } from '../../../locale/index.js'

/**
 * What Esc does when it reaches the layer stack: pops a layer. While a whole-list run holds the stack nothing may be popped, and the control is
 * out of sight, so the first press of the run says why in the live region (once per run, H-015); the others are silent.
 */
export function useLayerEscape(): () => void {
  const layerStack = useLayerStack()
  const { announce } = useLiveRegion()
  const said = useRef<number | null>(null)

  return () => {
    const run = layerStack.navigationRun
    if (!run) {
      layerStack.pop()
      return
    }
    if (said.current === run.id) return
    said.current = run.id
    announce(copy.quantum.hold.escape[run.kind])
  }
}
