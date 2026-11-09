import { useEffect, useState } from 'react'

/** The window’s inner width, the value the layers are laid out in (the rail’s rule reads it too), followed while it is resized. */
export function useInnerWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    // The window may have changed between the first render and this effect.
    onResize()

    return () => window.removeEventListener('resize', onResize)
  }, [])

  return width
}
