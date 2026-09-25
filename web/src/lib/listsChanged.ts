const EVENT = 'listulator:lists-changed'

/**
 * Something outside Home added or removed a list (an Undo of a delete, say),
 * while Home was covered and so not looking. Home refetches when it hears this.
 */
export function notifyListsChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

/** Returns the unsubscribe. */
export function subscribeListsChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)

  return () => window.removeEventListener(EVENT, listener)
}
