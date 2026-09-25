import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the system asks for less motion. Animation that carries meaning (the
 * Surprise Me spin) skips itself and shows the result at once. Read again when
 * the setting changes; a browser without `matchMedia` counts as "no preference".
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof matchMedia === 'function' ? matchMedia(QUERY).matches : false))

  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined
    const query = matchMedia(QUERY)
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    onChange()

    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
