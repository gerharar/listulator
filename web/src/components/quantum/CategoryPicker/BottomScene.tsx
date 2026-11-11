import { useState } from 'react'

/** The two scenes (X-006): the 80s desk and the fantasy landscape. */
export const SCENES = ['desk', 'landscape'] as const

export type Scene = (typeof SCENES)[number]

/** One of the two, at random: the lower half of the range is the desk. `random` is injectable so a test chooses. */
export function pickScene(random: () => number): Scene {
  return random() < 0.5 ? 'desk' : 'landscape'
}

/**
 * Choose Your Fighter's bottom scene (X-006, eX-Zed only; Quantum's picker draws none). Choose Your Fighter is also New List and the first run's screen, so it is
 * one component: the last thing in the picker's own scroll area, a picture of the desk or the landscape that the stylesheet draws as a mask filled with the skin's
 * progress colour (`exzed-art.css`). **Picked once each time the screen is opened**: the pick is the state's first value, so a re-render keeps the scene and a screen that
 * is opened again (a new mount) picks again. Decoration: hidden from assistive technology, nothing in it to reach.
 */
export function BottomScene({ random = Math.random }: { random?: () => number }) {
  const [scene] = useState<Scene>(() => pickScene(random))

  return (
    <div className="q-scene" aria-hidden="true">
      <div className="q-scene-art" data-scene={scene} />
    </div>
  )
}
