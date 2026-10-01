/**
 * What a layer's `content` string names. A layer's content is a path-shaped
 * string (D1: no URLs, the shape is only a convenient encoding): the shell
 * reads it to decide which screen a `list`, `new-list` or `preview` layer draws.
 */
export type LayerTarget =
  | { kind: 'home' }
  | { kind: 'list'; listId: string }
  | {
      kind: 'new-list'
      mediaType: string | undefined
      /** A search to run when the layer opens (Open in Mega, task 14.1). */
      query: string | undefined
      /** The result to open once that search answers. */
      openRef: string | undefined
    }
  | { kind: 'preview'; params: URLSearchParams }

const LIST_PATH = /^\/lists\/([^/?]+)$/

export function parseLayerPath(path: string): LayerTarget {
  const [pathname = '', search] = path.split('?')

  if (pathname === '/' || pathname === '') {
    return { kind: 'home' }
  }

  if (pathname === '/lists/new') {
    const params = new URLSearchParams(search)
    // An empty `q` or `open` is the same as none.
    return {
      kind: 'new-list',
      mediaType: params.get('mediaType') ?? undefined,
      query: params.get('q') || undefined,
      openRef: params.get('open') || undefined,
    }
  }

  if (pathname === '/lists/preview') {
    return { kind: 'preview', params: new URLSearchParams(search) }
  }

  const match = LIST_PATH.exec(pathname)
  if (match) {
    return { kind: 'list', listId: match[1]! }
  }

  // Nothing this app's layers recognise — Home is always safe.
  return { kind: 'home' }
}

/**
 * The path of a Create layer: the category, and optionally a search to run and a result to open in it. What the
 * category picker pushes and what Open in Mega replaces the layer with; the encoding is the one `parseLayerPath` reads.
 */
export function newListPath({
  mediaType,
  query,
  openRef,
}: {
  mediaType: string
  query?: string
  openRef?: string
}): string {
  const params = new URLSearchParams({ mediaType })
  if (query) params.set('q', query)
  if (openRef) params.set('open', openRef)

  return `/lists/new?${params.toString()}`
}

