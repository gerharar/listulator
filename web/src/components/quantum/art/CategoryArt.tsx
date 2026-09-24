import { getCategoryArt } from './categoryArtData.js'

export interface CategoryArtProps {
  /** The category's registry key (`movie`, `tv`, …) — never a display label. */
  registryKey: string
}

/**
 * A category tile's corner drawing (Quantum theme.md §5): oversized,
 * cropped off the tile's bottom-right corner by the tile's own
 * `overflow: hidden`, stroked in `currentColor` inside an opacity-.17
 * container so line crossings don't double up. An unrecognised registry
 * key renders the same box with no drawing inside it (`FALLBACK_ART`),
 * never a throw — see `getCategoryArt`.
 */
export function CategoryArt({ registryKey }: CategoryArtProps) {
  const art = getCategoryArt(registryKey)

  return (
    <div
      className="q-category-art"
      aria-hidden="true"
      style={{
        position: 'absolute',
        right: art.box.r,
        bottom: art.box.b,
        width: art.box.w,
        height: art.box.h,
        overflow: 'hidden',
        opacity: 'var(--o-art)',
        transform: art.box.flip ? 'scaleX(-1)' : undefined,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={art.box.w}
        height={art.box.h}
        viewBox={art.viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth="var(--art-stroke)"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {art.paths.map((d, index) => (
          <path key={index} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  )
}
