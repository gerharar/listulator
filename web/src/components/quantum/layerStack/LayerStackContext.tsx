import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  popLayer,
  popToIndex,
  pushLayer,
  replaceTopLayer,
  visibleLayers,
  type LayerDescriptor,
} from './layerStack.js'

/**
 * `content` is specialized to `string` here (a legacy screen's path) —
 * `layerStack.ts` itself stays generic, but this app has exactly one
 * concrete layer-content shape today. Widen this (and thread a real type
 * parameter through) only once a second shape actually shows up.
 */
export interface LayerStackContextValue {
  stack: readonly LayerDescriptor<string>[]
  visible: readonly LayerDescriptor<string>[]
  push: (layer: LayerDescriptor<string>) => void
  pop: () => void
  popToIndex: (index: number) => void
  replaceTop: (layer: LayerDescriptor<string>) => void
}

const LayerStackReactContext = createContext<LayerStackContextValue | null>(null)

export interface LayerStackProviderProps {
  home: LayerDescriptor<string>
  children: ReactNode
}

/**
 * The React half of the layer stack — `layerStack.ts` is the pure state
 * transitions, this is just `useState` plus stable callbacks. `home` seeds
 * the stack and can never itself be popped (`layerStack.ts`'s own
 * invariant).
 */
export function LayerStackProvider({ home, children }: LayerStackProviderProps) {
  const [stack, setStack] = useState<LayerDescriptor<string>[]>([home])

  const push = useCallback(
    (layer: LayerDescriptor<string>) => setStack((s) => pushLayer(s, layer)),
    [],
  )
  const pop = useCallback(() => setStack((s) => popLayer(s)), [])
  const popTo = useCallback((index: number) => setStack((s) => popToIndex(s, index)), [])
  const replaceTop = useCallback(
    (layer: LayerDescriptor<string>) => setStack((s) => replaceTopLayer(s, layer)),
    [],
  )

  const value = useMemo<LayerStackContextValue>(
    () => ({ stack, visible: visibleLayers(stack), push, pop, popToIndex: popTo, replaceTop }),
    [stack, push, pop, popTo, replaceTop],
  )

  return <LayerStackReactContext.Provider value={value}>{children}</LayerStackReactContext.Provider>
}

export function useLayerStack(): LayerStackContextValue {
  const context = useContext(LayerStackReactContext)
  if (!context) {
    throw new Error('useLayerStack must be used within a LayerStackProvider')
  }
  return context
}
