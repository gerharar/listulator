/**
 * What a layer's `content` string names. A layer's content is a path-shaped
 * string (D1: no URLs, the shape is only a convenient encoding): the shell
 * reads it to decide which screen a `list`, `new-list` or `preview` layer draws.
 */
export type LayerTarget =
  | { kind: 'home' }
  | { kind: 'list'; listId: string }
  | { kind: 'new-list'; mediaType: string | undefined }
  | { kind: 'preview'; params: URLSearchParams }

const LIST_PATH = /^\/lists\/([^/?]+)$/

export function parseLayerPath(path: string): LayerTarget {
  const [pathname = '', search] = path.split('?')

  if (pathname === '/' || pathname === '') {
    return { kind: 'home' }
  }

  if (pathname === '/lists/new') {
    const mediaType = new URLSearchParams(search).get('mediaType')
    return { kind: 'new-list', mediaType: mediaType ?? undefined }
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
