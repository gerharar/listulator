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

export type FacetKey = 'type' | 'language' | 'platform' | 'extra'

/** A tag as a list file writes it, and the name people see for it (`game` → Game). */
export interface FacetValue {
  tag: string
  label: string
  /** Other tags read as this value and kept as written (Music: EP and Single are a Mini). */
  aliases?: readonly string[]
  /** The name on the row's 58px chip, where `label` would not fit (Compilation → Comp, owner); filters and pickers keep `label`. */
  short?: string
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
  /** The value that alone counts when an item holds it among others (Music: a Compilation, not also an Album). */
  prevails?: string
  /**
   * A flag on top of the main value (Music: Live), not a kind of its own: no
   * Untagged button, and the tag editor ticks it beside the main pick.
   */
  flag?: boolean
  /** Keep `values` in the written order; otherwise the buttons and the picker go A–Z by shown name. */
  keepOrder?: boolean
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
  /** Show the options in this order; false: A–Z by the name shown, which only the screen knows (its language). */
  keepOrder: boolean
  /** A flag (Live): items without it hold none of the options, so every option on is not the same as All. */
  flag?: boolean
}

/** The selected option keys per facet. Nothing selected means nothing hidden. */
export type FacetSelection = Partial<Record<FacetKey, ReadonlySet<string>>>

interface Taggable {
  tags?: readonly string[] | null
}

const normal = (tag: string) => tag.trim().toLowerCase()

const valueOf = (value: string | FacetValue): FacetValue =>
  typeof value === 'string' ? { tag: value, label: value } : value

/** The values an item holds for one facet, each once: aliases read as their value, a prevailing value alone. */
function heldOptions(item: Taggable, def: FacetDef): FacetOption[] {
  const values = def.values?.map(valueOf)
  const index = new Map<string, number>()
  values?.forEach((value, at) => {
    for (const tag of [value.tag, ...(value.aliases ?? [])]) index.set(normal(tag), at)
  })
  const empty = def.noValue?.map(normal) ?? []
  const found = new Map<string, FacetOption>()

  for (const raw of item.tags ?? []) {
    // A platform tag reads through the owner's table (10.24c): an old code
    // counts as today's, and shows as the table writes it.
    let key = def.key === 'platform' ? platformKey(raw) : normal(raw)
    if (!key || empty.includes(key)) continue
    const at = values ? index.get(key) : undefined
    if (values && at === undefined) continue

    let label: string
    if (values) {
      key = normal(values[at!]!.tag)
      label = values[at!]!.label
    } else {
      label = def.key === 'platform' ? platformCode(raw) : raw.trim()
    }
    if (!found.has(key)) found.set(key, { key, label })
  }

  const prevailing = def.prevails ? found.get(normal(def.prevails)) : undefined
  if (prevailing) return [prevailing]
  // In the facet's own order, so a summary reads the same whatever order the tags were written in.
  const held = [...found.values()]
  if (values) {
    const order = values.map((value) => normal(value.tag))
    held.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  }
  return held
}

/** The values an item holds for a facet with a fixed set, as the facet writes them (EP → Mini), for the tag editor. */
export function heldValues(tags: readonly string[] | null | undefined, def: FacetDef): string[] {
  const values = def.values?.map(valueOf) ?? []
  return heldOptions({ tags }, def).flatMap((option) => values.find((value) => normal(value.tag) === option.key)?.tag ?? [])
}

/** The options an item holds for one facet: its values, or Untagged when none match (a flag has no Untagged). */
function optionsOf(item: Taggable, def: FacetDef): FacetOption[] {
  const held = heldOptions(item, def)
  return held.length || def.flag ? held : [{ key: UNTAGGED, label: 'Untagged' }]
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
  return {
    key: def.key,
    label: def.label,
    options: untagged ? [...ordered, untagged] : ordered,
    keepOrder: def.key === 'platform' || def.keepOrder === true,
    ...(def.flag ? { flag: true } : {}),
  }
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

/** The row's tag chip: the main value, and any flag drawn as a mark on it (owner: `ALBUM ●` for a live album). */
export interface TagChip {
  label: string
  flags: string[]
}

/**
 * What the tag column shows for an item: the value each facet with a fixed set
 * names (by its short name, if any), and its flags apart, for a mark on the chip (the chip is 58px: `Album
 * · Live` would not fit, owner 2026-09-27). An item with only a flag shows the
 * flag as its label; one no value names shows its first tag as written; none,
 * nothing.
 */
export function tagChip(
  tags: readonly string[] | null | undefined,
  convention: FacetConvention | undefined,
): TagChip | undefined {
  const labels = (flag: boolean) =>
    (convention ?? [])
      .filter((def) => def.values && (def.flag === true) === flag)
      .flatMap((def) => {
        const values = def.values!.map((value) => (typeof value === 'string' ? { tag: value, label: value } : value))
        return heldOptions({ tags }, def).map(
          (option) => values.find((value) => normal(value.tag) === option.key)?.short ?? option.label,
        )
      })
  const main = labels(false)
  const flags = labels(true)
  if (main.length) return { label: main.join(' · '), flags }
  if (flags.length) return { label: flags.join(' · '), flags: [] }
  const first = tags?.find((tag) => tag.trim())?.trim()
  return first ? { label: first, flags: [] } : undefined
}
