/** The two forms of the count note ("598 items", "483 of 598 shown"): the locale's `filter.total` and `filter.shown`. */
interface NoteForms {
  shown: (shown: number, total: number) => string
  total: (total: number) => string
}

/**
 * The longest form the count note takes for a list of `total` items (H-019 revision): "598 of 598 shown" while filtering at its fullest. The
 * note's slot is as many characters wide (`ch`, in the mono font), right-aligned, so Hide Completed or a filter changing its words moves nothing
 * beside it. Computed from the language's own strings, so German and Russian are covered; the first form wins a tie.
 */
export function noteRoomFor(total: number, forms: NoteForms): string {
  return [forms.shown(total, total), forms.total(total)].reduce((longest, form) => (form.length > longest.length ? form : longest))
}
