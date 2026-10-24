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

/** Matches `q-drumIn`/`q-drumShadow` in `LayerCard.css` — keep the two in sync. */
export const ENTER_DURATION_MS = 380

/**
 * `content` is specialized to `string` here (a legacy screen's path) —
 * `layerStack.ts` itself stays generic, but this app has exactly one
 * concrete layer-content shape today. Widen this (and thread a real type
 * parameter through) only once a second shape actually shows up.
 */
/** What `acquire` hands back: `release` ends this hold (once; a second call does nothing). */
export interface NavigationHold {
  release: () => void
}

/** Which whole-list run holds the stack, for the controls that wait for it to end (H-015): their tooltip, the Esc sentence and the Quit question. */
export interface NavigationRun {
  kind: 'reset' | 'order' | 'undo'
  /** The list being rewritten: the Quit question names it. */
  listName: string
}

export interface LayerStackContextValue {
  stack: readonly LayerDescriptor<string>[]
  visible: readonly LayerDescriptor<string>[]
  /** The id of the layer that just pushed or replaced the top, for `LayerCard`'s drum-in — `null` once the animation has had time to finish. */
  enteringId: string | null
  push: (layer: LayerDescriptor<string>) => void
  pop: () => void
  popToIndex: (index: number) => void
  replaceTop: (layer: LayerDescriptor<string>) => void
  /**
   * A list was just created (or its screen is otherwise the destination):
   * whatever was open — the picker, Create, Preview — is finished with, so the
   * stack becomes `[home, list]`. Also right on first run, where the picker was
   * the base layer and Home never existed (docs/DECISIONS.md).
   */
  landOnList: (list: LayerDescriptor<string>) => void
  /**
   * Home alone: the first-run picker was the base layer because there were no lists, and one is back (the Undo of Remove Sample, say), so My
   * Lists is the base again (H-018).
   */
  landOnHome: () => void
  /**
   * Freezes the stack until released: while anything holds it, `push`, `pop`, `popToIndex`, `replaceTop` and `landOnList` change nothing. A whole-list
   * rewrite (Reset, Restore order and their Undo) holds it, because a screen that is left mid-run is drawn again with a toast whose Undo belongs to the
   * screen that is gone, and the list on screen is then not the one in the database.
   */
  holdNavigation: (run?: NavigationRun) => NavigationHold
  /** True while anything holds the stack: the header's Quit warns, because a run that is cut short leaves its list half-finished. */
  navigationHeld: boolean
  /** The latest run that holds the stack, with an id of its own (a sentence said once per run is said again for the next); null with none, or a hold that named none. */
  navigationRun: (NavigationRun & { id: number }) | null
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
  // How many whole-list runs hold the stack. A ref, not state: a press that comes while it is held is refused at once, with no render in between.
  const holds = useRef(0)
  const [navigationHeld, setNavigationHeld] = useState(false)
  const [runs, setRuns] = useState<readonly (NavigationRun & { id: number })[]>([])
  const runIds = useRef(0)

  const markEntering = useCallback(
    (id: string) => {
      clearTimeout(timerRef.current)
      setEnteringId(id)
      timerRef.current = setTimeout(() => setEnteringId(null), ENTER_DURATION_MS)
    },
    [],
  )

  const push = useCallback(
    (layer: LayerDescriptor<string>) => {
      if (holds.current > 0) return
      setStack((s) => pushLayer(s, layer))
      markEntering(layer.id)
    },
    [markEntering],
  )
  const pop = useCallback(() => {
    if (holds.current === 0) setStack((s) => popLayer(s))
  }, [])
  const popTo = useCallback((index: number) => {
    if (holds.current === 0) setStack((s) => popToIndex(s, index))
  }, [])
  const replaceTop = useCallback(
    (layer: LayerDescriptor<string>) => {
      if (holds.current > 0) return
      setStack((s) => replaceTopLayer(s, layer))
      markEntering(layer.id)
    },
    [markEntering],
  )

  const landOnList = useCallback(
    (list: LayerDescriptor<string>) => {
      if (holds.current > 0) return
      setStack([home, list])
      markEntering(list.id)
    },
    [home, markEntering],
  )

  const landOnHome = useCallback(() => {
    if (holds.current > 0) return
    setStack([home])
  }, [home])

  const holdNavigation = useCallback((run?: NavigationRun): NavigationHold => {
    holds.current += 1
    setNavigationHeld(true)
    const named = run ? { ...run, id: (runIds.current += 1) } : undefined
    if (named) setRuns((current) => [...current, named])
    let released = false

    return {
      release: () => {
        if (released) return
        released = true
        holds.current -= 1
        setNavigationHeld(holds.current > 0)
        if (named) setRuns((current) => current.filter((entry) => entry !== named))
      },
    }
  }, [])

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
      landOnList,
      landOnHome,
      holdNavigation,
      navigationHeld,
      navigationRun: runs[runs.length - 1] ?? null,
    }),
    [stack, enteringId, push, pop, popTo, replaceTop, landOnList, landOnHome, holdNavigation, navigationHeld, runs],
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

const NO_HOLD: NavigationHold = { release: () => {} }

/**
 * Takes hold of the navigation (`holdNavigation`) from a screen that may be shown without a layer stack around it (a test): there it holds nothing.
 * Returns the function to call when a run starts; the run calls `release` when it ends, in a `finally`.
 */
export function useNavigationHold(): (run?: NavigationRun) => NavigationHold {
  const context = useContext(LayerStackReactContext)

  return context ? context.holdNavigation : () => NO_HOLD
}
