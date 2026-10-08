import { posix } from 'node:path'

/**
 * Checks that the links in the public documents point at files that are public (Phase 20, task 20.2; BL-012). Several
 * working documents (`SPEC.md`, `tasks/`, `docs/`, ...) live on the owner's computer only, so a link to one works
 * there and is a dead link for everyone on GitHub. "Public" therefore means tracked by git, not "exists on disk".
 */

export interface LocalLink {
  /** The path as written, without a `#fragment` or `?query`. */
  target: string
  line: number
}

/** A scheme (`https:`, `mailto:`), a protocol-relative `//host`, or a link to a place in the same page. */
const NOT_A_FILE = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i
const INLINE_LINK = /\]\((<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/

function cleanTarget(raw: string): string | undefined {
  const written = raw.startsWith('<') ? raw.slice(1, -1) : raw
  if (NOT_A_FILE.test(written)) return undefined

  const path = written.split(/[#?]/)[0] ?? ''
  if (path === '') return undefined

  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/** Every link to a file written in a Markdown text, skipping code spans and fenced blocks. */
export function localLinks(markdown: string): LocalLink[] {
  const found: LocalLink[] = []
  let fenced = false

  for (const [index, source] of markdown.split('\n').entries()) {
    if (/^\s*(```|~~~)/.test(source)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    const line = source.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length))
    const add = (raw: string | undefined) => {
      const target = raw === undefined ? undefined : cleanTarget(raw)
      if (target !== undefined) found.push({ target, line: index + 1 })
    }

    add(DEFINITION.exec(line)?.[1])
    for (const match of line.matchAll(INLINE_LINK)) add(match[1])
  }

  return found
}

/** One message per link in `markdown` (written in `file`) that does not lead to a tracked file or a folder holding one. */
export function brokenLinks(file: string, markdown: string, tracked: ReadonlySet<string>): string[] {
  const problems: string[] = []

  for (const { target, line } of localLinks(markdown)) {
    const resolved = target.startsWith('/') ? posix.normalize(target.slice(1)) : posix.normalize(posix.join(posix.dirname(file), target))
    const path = resolved.replace(/\/$/, '')
    const leavesTheRepository = path === '..' || path.startsWith('../')
    const isFile = tracked.has(path)
    const isFolder = [...tracked].some((entry) => entry.startsWith(`${path}/`))

    if (leavesTheRepository || !(isFile || isFolder)) {
      problems.push(`${file}:${line} links to ${path}, which is not a file in the repository`)
    }
  }

  return problems
}
