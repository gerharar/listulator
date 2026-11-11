/** One picture of the Category art group: its file's name (in `styles/theme/art/`), and its size in the README's art pixels. */
export interface BannerArt {
  file: string
  w: number
  h: number
}

export interface CategoryBannerSet {
  /** The list header's banner. */
  header: BannerArt
  /** The Choose Your Fighter tile's: the header's own art but for Pro Wrestling, and where the tile crops it (`x`, the mask's horizontal position; it is bottom-anchored). */
  tile: BannerArt & { x: '50%' | '100%' }
}

const set = (file: string, w: number, h: number, x: '50%' | '100%' = '50%'): CategoryBannerSet => ({ header: { file, w, h }, tile: { file, w, h, x } })

/**
 * eX-Zed's category banners (X-006): the registry key → the raster art the list header and the picker's tile draw as a mask in the skin's progress colour. By registry key (`movie`,
 * `tv`, …), never by label. Sizes are the Category art README's, in art pixels; the stylesheet shows two screen pixels to each (`exzed-art.css`, which names the files). The
 * tile crop positions are the Pick-Category board's. Pro Wrestling's tile has its own ring-only file.
 */
export const CATEGORY_BANNERS: Readonly<Record<string, CategoryBannerSet>> = {
  movie: set('movies', 193, 53, '100%'),
  tv: set('tv-series', 154, 58),
  animation: set('animation', 182, 74),
  documentary: set('documentaries', 201, 50, '100%'),
  wrestling: { header: { file: 'pro-wrestling', w: 202, h: 54 }, tile: { file: 'pro-wrestling-tile', w: 151, h: 54, x: '50%' } },
  mma: set('mma', 202, 60),
  game: set('games', 230, 56),
  comic: set('comics', 203, 71),
  book: set('books', 186, 57),
  music: set('music', 199, 46),
  youtube: set('youtube', 193, 81),
  mega: set('mega', 203, 60),
}

/**
 * A category's banners by registry key, or `null` for a key with none (the registry is open: a new media type draws no banner until one is drawn for it, and never throws).
 * Own keys only, so `constructor` or `__proto__` as a key is no category.
 */
export function bannerFor(registryKey: string): CategoryBannerSet | null {
  return Object.hasOwn(CATEGORY_BANNERS, registryKey) ? CATEGORY_BANNERS[registryKey]! : null
}
