import { tagChip, type FacetConvention } from '../../../../../server/src/catalog/facets.js'

/**
 * How many characters wide the kind tags of a list are (Phase 49, found at Checkpoint D). Design’s Tag card: every tag in a list is as wide as the longest tag
 * present. Quantum draws the tag at a fixed 58px and does not ask; eX-Zed’s font is one em wide a character, so the tag is sized from this count (`--kind-ch`, a
 * width in `ch`, exact where every character is as wide). The label is the one a row shows (`tagChip`, else the first tag), and a flag’s mark after it takes one
 * more. 0 when no item has a tag.
 */
export function kindColumnChars(items: readonly { tags?: readonly string[] | null }[], convention: FacetConvention | undefined): number {
  let widest = 0
  for (const item of items) {
    const chip = tagChip(item.tags, convention)
    const label = chip?.label ?? item.tags?.[0] ?? ''
    if (label === '') continue
    widest = Math.max(widest, label.length + (chip && chip.flags.length > 0 ? 1 : 0))
  }

  return widest
}
