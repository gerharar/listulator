import type { CSSProperties } from 'react'
import { bannerFor } from './categoryBanners.js'

export interface CategoryBannerProps {
  /** The category's registry key (`movie`, `tv`, …) — never a display label. */
  registryKey: string
  /** The list header's banner, or the Choose Your Fighter tile's art. */
  where: 'header' | 'tile'
}

/**
 * A category's banner under eX-Zed (X-006): a raster mask the stylesheet (`exzed-art.css`) fills with the skin's progress colour and draws at two screen pixels to an art pixel.
 * Pure decoration, so hidden from assistive technology. The element only names the art (`data-art`) and its size (`--banner-w`, `--banner-h`, in screen px) and, for a tile, where
 * the tile crops it (`--banner-x`); a registry key with no art renders **nothing**, not an empty box, and never throws (the registry is open).
 * In the list header it sits in a clip box that fills the header, so the header crops it without the header itself having to clip.
 */
export function CategoryBanner({ registryKey, where }: CategoryBannerProps) {
  const banners = bannerFor(registryKey)
  if (!banners) return null

  const art = where === 'tile' ? banners.tile : banners.header
  const style = {
    '--banner-w': `${art.w * 2}px`,
    '--banner-h': `${art.h * 2}px`,
    ...(where === 'tile' && { '--banner-x': banners.tile.x }),
  } as CSSProperties
  const banner = <div className="q-catbanner" data-where={where} data-art={art.file} style={style} aria-hidden={where === 'tile' ? 'true' : undefined} />

  return where === 'header' ? (
    <div className="q-catbanner-clip" aria-hidden="true">
      {banner}
    </div>
  ) : (
    banner
  )
}
