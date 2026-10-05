import { useEffect, useRef } from 'react'
import type { MediaType } from './api.js'

/**
 * "The media-type registry has changed" (16.5 finding, 2026-10-06): saving a key in Settings rebuilds the desktop
 * registry, so what each category can search and preview may be different now. The app's screens hold the list of
 * media types they were given, fetched once by Home; on a first run the category picker replaces Home, so nothing
 * fetched it again, and a TMDB preview stayed off ("too shy") after its key was entered. Settings notifies here, and
 * the shell fetches again.
 */
type Listener = () => void

const listeners = new Set<Listener>()

export function notifyRegistryChanged(): void {
  for (const listener of listeners) listener()
}

function onRegistryChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Fetches the media types again on every change and hands them to `apply`. Only the newest answer counts (a key is
 * saved as it is typed, so changes come letter by letter); a failed fetch keeps what is already shown.
 */
export function useRefetchOnRegistryChange(fetch: () => Promise<MediaType[]>, apply: (types: MediaType[]) => void): void {
  const latest = useRef({ fetch, apply })
  latest.current = { fetch, apply }

  useEffect(() => {
    let asked = 0
    let live = true
    const stop = onRegistryChanged(() => {
      const mine = ++asked
      latest.current
        .fetch()
        .then((types) => {
          if (live && mine === asked) latest.current.apply(types)
        })
        .catch(() => {
          // Keep what is shown: the next change, or the next Home visit, asks again.
        })
    })

    return () => {
      live = false
      stop()
    }
  }, [])
}
