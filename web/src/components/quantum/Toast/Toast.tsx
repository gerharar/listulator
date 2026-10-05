import './Toast.css'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '../Button/Button.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'

export interface ToastOptions {
  text: string
  /** Both or neither — an action needs somewhere to go. */
  actionLabel?: string
  onAction?: () => void
}

const TOAST_DURATION_MS = 3000
const TOAST_ACTION_DURATION_MS = 5000

/**
 * A plain toast lasts 3s; one with an action (Undo) lasts 5s. The design system said 3.2s and 8s; the owner found 8s
 * far too long (2026-10-05).
 */
export function toastDuration(hasAction: boolean): number {
  return hasAction ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS
}

export interface ToastContextValue {
  showToast: (options: ToastOptions) => void
}

const ToastReactContext = createContext<ToastContextValue | null>(null)

/**
 * One at a time, top-centre. Must be mounted **outside any layer** (task
 * 10.9's job — nothing mounts a layer stack yet) so an Undo toast survives
 * leaving the screen that raised it. Requires a `LiveRegionProvider`
 * further up the tree: every toast also says its text there.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastOptions | null>(null)
  const { announce } = useLiveRegion()
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const showToast = useCallback(
    (options: ToastOptions) => {
      clearTimeout(timerRef.current)
      setToast(options)
      announce(options.text)
      timerRef.current = setTimeout(() => setToast(null), toastDuration(!!options.actionLabel))
    },
    [announce],
  )

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return (
    <ToastReactContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="q-toast fixed">
          <span>{toast.text}</span>
          {toast.actionLabel && toast.onAction && (
            <Button
              onClick={() => {
                clearTimeout(timerRef.current)
                setToast(null)
                toast.onAction?.()
              }}
            >
              {toast.actionLabel}
            </Button>
          )}
        </div>
      )}
    </ToastReactContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastReactContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
