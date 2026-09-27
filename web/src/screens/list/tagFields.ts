import type { FacetConvention, FacetValue } from '../../../../server/src/catalog/facets.js'

/**
 * Which tag field an item gets by hand (U5), from its category's facets:
 * Games pick platforms in the Platform panel; a category whose facet has a
 * short fixed set of values (Music, Animation: Type; Mega: Medium) picks one
 * from a dropdown; an open-ended facet (a book's language) or no facet at all
 * gets no field.
 */
export type TagField =
  | { kind: 'platform' }
  | { kind: 'choice'; label: string; values: FacetValue[] }

const normal = (tag: string) => tag.trim().toLowerCase()

export function tagField(facets: FacetConvention | undefined): TagField | null {
  if (!facets) return null
  if (facets.some((facet) => facet.key === 'platform')) return { kind: 'platform' }
  const fixed = facets.find((facet) => facet.values && facet.values.length > 0)
  if (!fixed?.values) return null
  return {
    kind: 'choice',
    label: fixed.label,
    values: fixed.values.map((value) => (typeof value === 'string' ? { tag: value, label: value } : value)),
  }
}

/** The facet's values the item carries, spelt as the facet spells them, in its order. */
export function choiceOf(
  tags: readonly string[] | null | undefined,
  field: Extract<TagField, { kind: 'choice' }>,
): string[] {
  const held = new Set((tags ?? []).map(normal))
  return field.values.filter((value) => held.has(normal(value.tag))).map((value) => value.tag)
}

/** The item's tags with the facet's values replaced by `choice` (none for null); every other tag kept. */
export function withChoice(
  tags: readonly string[] | null | undefined,
  field: Extract<TagField, { kind: 'choice' }>,
  choice: string | null,
): string[] {
  const facetTags = new Set(field.values.map((value) => normal(value.tag)))
  const others = (tags ?? []).filter((tag) => !facetTags.has(normal(tag)))
  return choice ? [...others, choice] : others
}

/** Whether two tag sets differ, ignoring case, order and repeats: an untouched field never rewrites stored tags. */
export function tagsDiffer(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const key = (tags: readonly string[] | null | undefined) => [...new Set((tags ?? []).map(normal))].sort().join('\n')
  return key(a) !== key(b)
}
