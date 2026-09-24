/**
 * Where an old screen's `navigate()`/`<Link>` call was trying to go,
 * translated into what the layer stack should do about it — task 10.9's
 * bridge for old screens that "still call router hooks" (D1: no real URL
 * change happens; see `legacyRouterBridge.tsx`).
 */
export type LegacyNavigationTarget =
  | { kind: 'home' }
  | { kind: 'list'; listId: string }
  | { kind: 'new-list'; mediaType: string | undefined }

const LIST_PATH = /^\/lists\/([^/?]+)$/

export function parseLegacyPath(path: string): LegacyNavigationTarget {
  const [pathname = '', search] = path.split('?')

  if (pathname === '/' || pathname === '') {
    return { kind: 'home' }
  }

  if (pathname === '/lists/new') {
    const mediaType = new URLSearchParams(search).get('mediaType')
    return { kind: 'new-list', mediaType: mediaType ?? undefined }
  }

  const match = LIST_PATH.exec(pathname)
  if (match) {
    return { kind: 'list', listId: match[1]! }
  }

  // Nothing this app's three old routes recognise — Home is always safe.
  return { kind: 'home' }
}
