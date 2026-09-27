import { heldValues, type FacetConvention, type FacetDef, type FacetValue } from '../../../../server/src/catalog/facets.js'

/**
 * Which tag field an item gets by hand (U5), from its category's facets:
 * Games pick platforms in the Platform panel; a category whose facet has a
 * short fixed set of values (Music, Animation: Type; Mega: Medium) picks one
 * from a dropdown, with any flag facet (Music: Live) ticked beside it; an
 * open-ended facet (a book's language) or no facet at all gets no field.
 */
export type TagField =
  | { kind: 'platform' }
  | {
      kind: 'choice'
      label: string
      values: FacetValue[]
      /** Flags ticked on top of the main value (Music: Live). */
      flags: FacetValue[]
      /** Keep `values` in the written order; otherwise the picker goes A–Z by shown name. */
      keepOrder: boolean
      main: FacetDef
      flagDefs: FacetDef[]
    }

type ChoiceField = Extract<TagField, { kind: 'choice' }>

/** An item's pick: one main value (or none) and the flags it has, each as its facet writes it. */
export interface Choice {
  main: string | null
  flags: string[]
}

const normal = (tag: string) => tag.trim().toLowerCase()

const valueOf = (value: string | FacetValue): FacetValue =>
  typeof value === 'string' ? { tag: value, label: value } : { tag: value.tag, label: value.label }

export function tagField(facets: FacetConvention | undefined): TagField | null {
  if (!facets) return null
  if (facets.some((facet) => facet.key === 'platform')) return { kind: 'platform' }
  const main = facets.find((facet) => !facet.flag && facet.values && facet.values.length > 0)
  if (!main?.values) return null
  const flagDefs = facets.filter((facet) => facet.flag && facet.values)
  return {
    kind: 'choice',
    label: main.label,
    values: main.values.map(valueOf),
    flags: flagDefs.flatMap((facet) => facet.values!.map(valueOf)),
    keepOrder: main.keepOrder === true,
    main,
    flagDefs,
  }
}

/** The tags that mean a facet's values, aliases included (EP, Single for Mini). */
function facetTags(def: FacetDef): Set<string> {
  return new Set(
    (def.values ?? []).flatMap((value) =>
      typeof value === 'string' ? [normal(value)] : [value.tag, ...(value.aliases ?? [])].map(normal),
    ),
  )
}

/** The item's pick, read the way the filter bar reads it: EP is a Mini, a Compilation beats an Album. */
export function readChoice(tags: readonly string[] | null | undefined, field: ChoiceField): Choice {
  return {
    main: heldValues(tags, field.main)[0] ?? null,
    flags: field.flagDefs.flatMap((def) => heldValues(tags, def)),
  }
}

/**
 * The item's tags with the facet's part replaced by `next`; every other tag kept.
 * While the main value stays, its tags stay as written (an EP stays EP, the Album
 * under a Compilation stays): only a new main value is written, in its facet's
 * spelling (owner, 2026-09-27: the source's details are worth keeping).
 */
export function writeChoice(tags: readonly string[] | null | undefined, field: ChoiceField, next: Choice): string[] {
  const held = tags ?? []
  const mainTags = facetTags(field.main)
  const flagTags = new Set(field.flagDefs.flatMap((def) => [...facetTags(def)]))
  const others = held.filter((tag) => !mainTags.has(normal(tag)) && !flagTags.has(normal(tag)))

  const main =
    next.main === readChoice(held, field).main
      ? held.filter((tag) => mainTags.has(normal(tag)))
      : next.main
        ? [next.main]
        : []
  const flags = next.flags.map((flag) => held.find((tag) => normal(tag) === normal(flag)) ?? flag)
  return [...others, ...main, ...flags]
}

/** Whether two picks are the same. */
export function sameChoice(a: Choice, b: Choice): boolean {
  return a.main === b.main && a.flags.join('\n') === b.flags.join('\n')
}

/** Whether two tag sets differ, ignoring case, order and repeats: an untouched field never rewrites stored tags. */
export function tagsDiffer(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const key = (tags: readonly string[] | null | undefined) => [...new Set((tags ?? []).map(normal))].sort().join('\n')
  return key(a) !== key(b)
}
