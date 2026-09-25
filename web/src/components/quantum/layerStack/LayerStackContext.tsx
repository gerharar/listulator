import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  popLayer,
  popToIndex,
  pushLayer,
  replaceTopLayer,
  visibleLayers,
  type LayerDescriptor,
} from './layerStack.js'
import { useMotion } from '../Motion/MotionContext.js'

/** Matches `q-drumIn`/`q-drumShadow` in `LayerCard.css` — keep the two in sync. */
export const ENTER_DURATION_MS = 380
/** Matches `q-pushIn` under `[data-motion='push']` in `LayerCard.css`. */
export const PUSH_DURATION_MS = 210

/**
 * `content` is specialized to `string` here (a legacy screen's path) —
 * `layerStack.ts` itself stays generic, but this app has exactly one
 * concrete layer-content shape today. Widen this (and thread a real type
 * parameter through) only once a second shape actually shows up.
 */
export interface LayerStackContextValue {
  stack: readonly LayerDescriptor<string>[]
  visible: readonly LayerDescriptor<string>[]
  /** The id of the layer that just pushed or replaced the top, for `LayerCard`'s drum-in — `null` once the animation has had time to finish. */
  enteringId: string | null
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
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { motion } = useMotion()
  const enterMs = motion === 'push' ? PUSH_DURATION_MS : ENTER_DURATION_MS

  const markEntering = useCallback(
    (id: string) => {
      clearTimeout(timerRef.current)
      setEnteringId(id)
      timerRef.current = setTimeout(() => setEnteringId(null), enterMs)
    },
    [enterMs],
  )

  const push = useCallback(
    (layer: LayerDescriptor<string>) => {
      setStack((s) => pushLayer(s, layer))
      markEntering(layer.id)
    },
    [markEntering],
  )
  const pop = useCallback(() => setStack((s) => popLayer(s)), [])
  const popTo = useCallback((index: number) => setStack((s) => popToIndex(s, index)), [])
  const replaceTop = useCallback(
    (layer: LayerDescriptor<string>) => {
      setStack((s) => replaceTopLayer(s, layer))
      markEntering(layer.id)
    },
    [markEntering],
  )

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const value = useMemo<LayerStackContextValue>(
    () => ({
      stack,
      visible: visibleLayers(stack),
      enteringId,
      push,
      pop,
      popToIndex: popTo,
      replaceTop,
    }),
    [stack, enteringId, push, pop, popTo, replaceTop],
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
