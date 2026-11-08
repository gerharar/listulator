import type { PageDump } from './dump.js'

/** Every difference between two dumps of the same state, one line each; an empty list means the page is the same. */
/** The last three steps of a path are enough to find an element in a report; the whole path is what keys it. */
const short = (path: string) => `…${path.split(">").slice(-3).join(">")}`

export function diffDumps(before: PageDump, after: PageDump): string[] {
  const lines: string[] = []
  const index = (dump: PageDump) => new Map(dump.elements.map((element) => [element.path, element]))
  const was = index(before)
  const now = index(after)
  for (const path of was.keys()) if (!now.has(path)) lines.push(`removed  ${short(path)}`)
  for (const path of now.keys()) if (!was.has(path)) lines.push(`added    ${short(path)}`)
  for (const [path, a] of was) {
    const b = now.get(path)
    if (b === undefined) continue
    if (a.rect !== undefined && b.rect !== undefined && a.rect.some((n, i) => n !== b.rect![i])) {
      lines.push(`box      ${short(path)}  [${a.rect.join(', ')}] -> [${b.rect.join(', ')}]`)
    }
    if ((a.text ?? '') !== (b.text ?? '')) lines.push(`text     ${short(path)}  ${JSON.stringify(a.text ?? '')} -> ${JSON.stringify(b.text ?? '')}`)
    const rowA = before.styles[a.style]!
    const rowB = after.styles[b.style]!
    before.props.forEach((prop, n) => {
      const propB = after.props.indexOf(prop)
      const valueB = propB === -1 ? undefined : rowB[propB]
      if (rowA[n] !== valueB) lines.push(`style    ${short(path)}  ${prop}: ${rowA[n]} -> ${valueB}`)
    })
  }
  return lines
}
