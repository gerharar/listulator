import './AppErrorBoundary.css'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { copy } from '../../../locale/index.js'
import { ErrorBlock } from '../ErrorBlock/ErrorBlock.js'

export interface AppErrorBoundaryProps {
  children: ReactNode
  /** For a test; the real page reload otherwise. */
  onReload?: () => void
}

interface State {
  crashed: boolean
}

/**
 * The last line of defence around the whole app: an error nothing else caught
 * would otherwise unmount everything and leave a blank (black) window. It
 * shows the ordinary ErrorBlock instead, with one way out, Reload. It sits
 * outside every provider, so it reads the plain `copy` and needs none of them.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, State> {
  override state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Listulator] the app crashed', error, info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children

    const text = copy.quantum.crash
    const reload = this.props.onReload ?? (() => window.location.reload())

    return (
      <div className="q-crash" role="alert">
        <ErrorBlock headline={text.headline} explanation={text.explanation} action={{ label: text.reload, onClick: reload }} />
      </div>
    )
  }
}
