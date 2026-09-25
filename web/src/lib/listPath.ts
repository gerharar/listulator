/**
 * The list layer's own path (D1: a layer's content is a path string, no
 * router state). `?update=1` says "the Home banner sent you here because the
 * source has news" — a cue, never an automatic network call.
 */
export function listPath(listId: string, options: { update?: boolean } = {}): string {
  return options.update ? `/lists/${listId}?update=1` : `/lists/${listId}`
}

export function wantsUpdate(params: URLSearchParams): boolean {
  return params.get('update') === '1'
}
