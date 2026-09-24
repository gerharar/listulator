/**
 * Category tile line art (Quantum theme §5), ported verbatim from
 * `reference/quantum-engine.js`'s `LINEART` / `ART_BOX` / `ART_VIEW`.
 *
 * Looked up by **registry key** (C1), never by the design's own display
 * label or a switch over category names — `CATEGORY_ART_BY_REGISTRY_KEY`
 * below is the one place that mapping exists. A key with no entry (any
 * future media type not yet given art) gets `FALLBACK_ART`: no drawing,
 * the same tile shape, never a throw.
 */

export interface CategoryArtBox {
  w: number
  h: number
  /** Right offset, negative — pushes the box off the tile's corner. */
  r: number
  /** Bottom offset, negative. */
  b: number
  /** Documentaries only: the camcorder's lens has to stay on-tile once cropped. */
  flip?: boolean
}

export interface CategoryArt {
  paths: string[]
  viewBox: string
  box: CategoryArtBox
}

/** Lucide icons use a 24×24 viewBox by convention; `ART_VIEW` only overrides the wide ones. */
const DEFAULT_VIEW_BOX = '0 0 24 24'

/** Quantum theme.md §5: "The default is 116×116 at right −20px / bottom −22px." */
const DEFAULT_BOX: CategoryArtBox = { w: 116, h: 116, r: -20, b: -22 }

export const FALLBACK_ART: CategoryArt = { paths: [], viewBox: DEFAULT_VIEW_BOX, box: DEFAULT_BOX }

/** `LINEART` verbatim, keyed by the design's own display label. */
const LINE_ART_BY_LABEL: Record<string, string[]> = {
  Movies: [
    'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z',
    'm6.2 5.3 3.1 3.9',
    'm12.4 3.4 3.1 4',
    'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  ],
  'TV Series': [
    'm17 2-5 5-5-5',
    'M4 7h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  ],
  Animation: [
    'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2z',
    'M14.25 6.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0',
    'M18.25 10.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0',
    'M9.25 7.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0',
    'M7.25 12.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0',
  ],
  Documentaries: [
    'm16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.5L16 10.5',
    'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  ],
  'Pro Wrestling': [
    'M6 9H4.5a2.5 2.5 0 0 1 0-5H6',
    'M18 9h1.5a2.5 2.5 0 0 0 0-5H18',
    'M4 22h16',
    'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22',
    'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22',
    'M18 2H6v7a6 6 0 0 0 12 0V2Z',
  ],
  // The cage, drawn as a true regular octagon — no corner rounding.
  MMA: ['M8.2 2h7.6L22 8.2v7.6L15.8 22H8.2L2 15.8V8.2z'],
  Games: [
    'M6 12h4',
    'M8 10v4',
    'M15.6 13a.6.6 0 1 1-1.2 0 .6.6 0 0 1 1.2 0',
    'M18.6 11a.6.6 0 1 1-1.2 0 .6.6 0 0 1 1.2 0',
    'M17.32 5H6.68a4 4 0 0 0-3.98 3.59c-.01.05-.01.1-.02.15C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.41.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.54-.6-6.58-.69-7.26A4 4 0 0 0 17.32 5z',
  ],
  // A comics page ruled into empty panels, rather than a speech balloon.
  Comics: [
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M12 3v6',
    'M3 9h18',
    'M3 15h18',
    'M9 15v6',
  ],
  Books: [
    'M12 7v14',
    'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
  ],
  Music: [
    'M9 18V5l12-2v13',
    'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  ],
  YouTube: [
    'M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17',
    'm10 15 5-3-5-3z',
  ],
  Mega: [
    'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
    'm6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59',
    'm6.08 14.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59',
  ],
}

/** `ART_VIEW` verbatim — only the wide drawings need a tightened viewBox (see the comment on `DEFAULT_VIEW_BOX`). */
const ART_VIEW_OVERRIDES: Record<string, string> = {
  Documentaries: '1.5 5.5 21 13',
  Games: '1.5 4.5 21 15',
  YouTube: '1.6 4.1 20.8 15.8',
}

/** `ART_BOX` verbatim. */
const ART_BOX_OVERRIDES: Record<string, CategoryArtBox> = {
  Documentaries: { w: 162, h: 97, r: -66, b: -12, flip: true },
  Games: { w: 139, h: 97, r: -43, b: -12 },
  YouTube: { w: 135, h: 102, r: -39, b: -14 },
}

/**
 * Registry key → the design's own display label, so `LINE_ART_BY_LABEL`
 * above stays a verbatim, unedited port of `LINEART`. The only place a
 * category name is spelled out for matching purposes.
 */
const REGISTRY_KEY_TO_LABEL: Record<string, string> = {
  movie: 'Movies',
  tv: 'TV Series',
  animation: 'Animation',
  documentary: 'Documentaries',
  wrestling: 'Pro Wrestling',
  mma: 'MMA',
  game: 'Games',
  comic: 'Comics',
  book: 'Books',
  music: 'Music',
  youtube: 'YouTube',
  mega: 'Mega',
}

/**
 * Looks up a category's tile art by registry key (C1). An unrecognised
 * key — any media type the registry has that this table doesn't yet cover
 * — gets `FALLBACK_ART` rather than throwing, so the tile grid stays
 * open to future categories with zero code change here.
 */
export function getCategoryArt(registryKey: string): CategoryArt {
  const label = REGISTRY_KEY_TO_LABEL[registryKey]
  const paths = label ? LINE_ART_BY_LABEL[label] : undefined
  if (!label || !paths) return FALLBACK_ART

  return {
    paths,
    viewBox: ART_VIEW_OVERRIDES[label] ?? DEFAULT_VIEW_BOX,
    box: ART_BOX_OVERRIDES[label] ?? DEFAULT_BOX,
  }
}
