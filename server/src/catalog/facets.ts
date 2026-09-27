import { platformCode, platformKey } from './platforms.js'

/**
 * Filter facets, derived at read time from an item's `tags` (SPEC.md §4).
 * Which tags mean what is a per-category convention declared on the media
 * type registry entry; nothing here knows a category key, so a new category
 * gets facets by declaring a convention and touches neither `catalog` nor
 * `suggestions`. Browser-safe: the standalone app imports this too.
 */

/**
 * How many tags one item may carry. A long-lived game is on more platforms than
 * the old cap of 20 (the table alone has 28 codes), and refusing its tags would
 * refuse the whole import; the importers and both schemas read this one number.
 */
export const MAX_ITEM_TAGS = 40

/**
 * Tags typed or picked by hand (U5), as stored: trimmed, blanks dropped, one
 * spelling per tag regardless of case (the first), and none at all as null.
 */
export function normalizeItemTags(tags: readonly string[] | null | undefined): string[] | null {
  if (!tags) return null
  const kept: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim()
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    kept.push(tag)
  }
  return kept.length > 0 ? kept : null
}

export type FacetKey = 'type' | 'language' | 'platform'

/** A tag as a list file writes it, and the name people see for it (`game` → Game). */
export interface FacetValue {
  tag: string
  label: string
}

export interface FacetDef {
  key: FacetKey
  /** The mono kicker in the filter bar: Type, Medium, Language, Platform. */
  label: string
  /**
   * The tags that mean this facet, in the order the buttons appear; a plain
   * string is its own label. Absent means every tag counts (a language, a
   * platform) and the buttons follow first appearance in the list.
   */
  values?: readonly (string | FacetValue)[]
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

const valueOf = (value: string | FacetValue): FacetValue =>
  typeof value === 'string' ? { tag: value, label: value } : value

/** The options an item holds for one facet: matching tags, or Untagged when none match. */
function optionsOf(item: Taggable, def: FacetDef): FacetOption[] {
  const values = def.values?.map(valueOf)
  const known = values?.map((value) => normal(value.tag))
  const empty = def.noValue?.map(normal) ?? []
  const found: FacetOption[] = []

  for (const raw of item.tags ?? []) {
    // A platform tag reads through the owner's table (10.24c): an old code
    // counts as today's, and shows as the table writes it.
    const key = def.key === 'platform' ? platformKey(raw) : normal(raw)
    if (!key || empty.includes(key)) continue
    const index = known ? known.indexOf(key) : -1
    if (known && index < 0) continue

    const label = values ? values[index]!.label : def.key === 'platform' ? platformCode(raw) : raw.trim()
    found.push({ key, label })
  }

  return found.length ? found : [{ key: UNTAGGED, label: 'Untagged' }]
}

/**
 * Platform buttons A to Z by the code shown, known and unknown alike, then
 * Untagged (owner, 2026-09-27: with dozens of platforms the table's own order
 * made one hard to find). Plain character order, digits first.
 */
function comparePlatforms(a: FacetOption, b: FacetOption): number {
  const last = (option: FacetOption) => (option.key === UNTAGGED ? 1 : 0)
  return last(a) - last(b) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
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
    const known = def.values.map((value) => normal(valueOf(value).tag))
    ordered = [...tagged].sort((a, b) => known.indexOf(a.key) - known.indexOf(b.key))
  } else if (def.key === 'platform') {
    ordered = [...tagged].sort(comparePlatforms)
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

/** What the tag column shows for a tag: a facet value's display name, else the tag as written. */
export function displayTag(tag: string, convention: FacetConvention | undefined): string {
  const key = normal(tag)
  for (const def of convention ?? []) {
    const match = def.values?.map(valueOf).find((value) => normal(value.tag) === key)
    if (match) return match.label
  }

  return tag
}
