import { PLATFORM_ORDER } from './platforms.js'

/**
 * Filter facets, derived at read time from an item's `tags` (SPEC.md §4).
 * Which tags mean what is a per-category convention declared on the media
 * type registry entry; nothing here knows a category key, so a new category
 * gets facets by declaring a convention and touches neither `catalog` nor
 * `suggestions`. Browser-safe: the standalone app imports this too.
 */

export type FacetKey = 'type' | 'language' | 'platform'

export interface FacetDef {
  key: FacetKey
  /** The mono kicker in the filter bar: Type, Medium, Language, Platform. */
  label: string
  /**
   * The tags that mean this facet, in the order the buttons appear. Absent
   * means every tag counts (a language, a platform, a Mega medium) and the
   * buttons follow first appearance in the list.
   */
  values?: readonly string[]
  /** Tags that say "no value known" and count as untagged (an Unknown language). */
  noValue?: readonly string[]
}

/** What a registry entry declares. Absent or empty: the category has no facets. */
export type FacetConvention = readonly FacetDef[]

export const UNTAGGED = '__untagged'

export interface FacetOption {
  key: string
  label: string
}

export interface FacetGroup {
  key: FacetKey
  label: string
  options: FacetOption[]
}

/** The selected option keys per facet. Nothing selected means nothing hidden. */
export type FacetSelection = Partial<Record<FacetKey, ReadonlySet<string>>>

interface Taggable {
  tags?: readonly string[] | null
}

const normal = (tag: string) => tag.trim().toLowerCase()

/** The options an item holds for one facet: matching tags, or Untagged when none match. */
function optionsOf(item: Taggable, def: FacetDef): FacetOption[] {
  const known = def.values?.map(normal)
  const empty = def.noValue?.map(normal) ?? []
  const found: FacetOption[] = []

  for (const raw of item.tags ?? []) {
    const key = normal(raw)
    if (!key || empty.includes(key)) continue
    const index = known ? known.indexOf(key) : -1
    if (known && index < 0) continue

    const label = known ? def.values![index]! : def.key === 'platform' ? raw.trim().toUpperCase() : raw.trim()
    found.push({ key, label })
  }

  return found.length ? found : [{ key: UNTAGGED, label: 'Untagged' }]
}

/**
 * Canonical platform order, then codes the table doesn't know (first seen),
 * then MULTI, then Untagged — the order the README fixes.
 */
function platformRank(key: string): number {
  if (key === UNTAGGED) return Number.MAX_SAFE_INTEGER
  if (key === 'multi') return PLATFORM_ORDER.length + 1_000_000
  const index = PLATFORM_ORDER.indexOf(key)
  return index < 0 ? PLATFORM_ORDER.length : index
}

function deriveOne(items: readonly Taggable[], def: FacetDef): FacetGroup | null {
  const seen = new Map<string, FacetOption>()
  for (const item of items) {
    for (const option of optionsOf(item, def)) if (!seen.has(option.key)) seen.set(option.key, option)
  }

  const tagged = [...seen.values()].filter((option) => option.key !== UNTAGGED)
  // No tag means the facet has nothing to offer, so the bar stays without it.
  if (tagged.length === 0) return null

  let ordered = tagged
  if (def.values) {
    const known = def.values.map(normal)
    ordered = [...tagged].sort((a, b) => known.indexOf(a.key) - known.indexOf(b.key))
  } else if (def.key === 'platform') {
    ordered = [...tagged].sort((a, b) => platformRank(a.key) - platformRank(b.key))
  }

  const untagged = seen.get(UNTAGGED)
  return { key: def.key, label: def.label, options: untagged ? [...ordered, untagged] : ordered }
}

/** The facets this list's items support under a category's convention, in the convention's order. */
export function deriveFacets(
  items: readonly Taggable[],
  convention: FacetConvention | undefined,
): FacetGroup[] {
  return (convention ?? []).flatMap((def) => deriveOne(items, def) ?? [])
}

/**
 * Additive toggles: within a facet an item matches when any selected option
 * is among its own; across facets every one with a selection must match.
 */
export function matchesFacets(
  item: Taggable,
  convention: FacetConvention | undefined,
  selection: FacetSelection,
): boolean {
  return (convention ?? []).every((def) => {
    const chosen = selection[def.key]
    if (!chosen || chosen.size === 0) return true
    return optionsOf(item, def).some((option) => chosen.has(option.key))
  })
}
