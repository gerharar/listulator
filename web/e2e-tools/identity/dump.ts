import type { Page } from '@playwright/test'

/**
 * What is compared besides the screenshot: for every element, and for its `::before` / `::after` when they draw something, the box and the
 * computed values that decide how it looks. Styles are stored once in a table and the elements point at a row, so a page of a few thousand
 * elements stays a few hundred kilobytes.
 */
export const DUMP_PROPS = [
  'display', 'position', 'box-sizing', 'visibility', 'z-index', 'overflow-x', 'overflow-y', 'float', 'content',
  'top', 'right', 'bottom', 'left', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'box-shadow', 'text-shadow', 'opacity', 'filter', 'backdrop-filter', 'mix-blend-mode', 'transform', 'clip-path',
  'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-blend-mode',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric', 'font-stretch', 'font-synthesis', 'line-height', 'letter-spacing',
  'text-transform', 'text-align', 'text-decoration-line', 'text-overflow', 'white-space', 'vertical-align', 'image-rendering', 'cursor',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self', 'justify-content', 'order', 'gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column-start', 'grid-column-end',
  'fill', 'stroke', 'stroke-width', 'pointer-events', 'animation-name', 'transition-property',
] as const

export interface PageDump {
  props: readonly string[]
  /** Rows of values, in the order of `props`. */
  styles: string[][]
  elements: DumpedElement[]
}

export interface DumpedElement {
  /** Where it is: tag, classes and position among its siblings, from the root. Unique within a page. */
  path: string
  /** Left, top, width, height; absent for a pseudo-element, which has no box of its own to measure. */
  rect?: [number, number, number, number]
  /** Index into `styles`. */
  style: number
  /** Its own text and, for a field, its value. */
  text?: string
}

/** Runs in the page. Everything it needs is passed in or defined inside: Playwright serialises the function, not its closure. */
export function dumpPage(page: Page): Promise<PageDump> {
  return page.evaluate((props) => {
    const table = new Map<string, number>()
    const styles: string[][] = []
    const intern = (cs: CSSStyleDeclaration): number => {
      const row = props.map((name) => cs.getPropertyValue(name))
      const key = row.join('\u0001')
      let index = table.get(key)
      if (index === undefined) {
        index = styles.length
        styles.push(row)
        table.set(key, index)
      }
      return index
    }
    const round = (n: number) => Math.round(n * 1000) / 1000
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'HEAD', 'NOSCRIPT'])
    const elements: DumpedElement[] = []

    const visit = (el: Element, parentPath: string, nth: number) => {
      const classes = typeof el.className === 'string' && el.className.trim() !== '' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''
      const path = `${parentPath}>${el.tagName.toLowerCase()}${classes}:${nth}`
      const rect = el.getBoundingClientRect()
      const own = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? '')
        .filter((text) => text !== '')
        .join(' ')
      const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : ''
      const text = [own, value].filter((part) => part !== '').join(' | ')
      const entry: DumpedElement = { path, rect: [round(rect.left), round(rect.top), round(rect.width), round(rect.height)], style: intern(getComputedStyle(el)) }
      if (text !== '') entry.text = text
      elements.push(entry)
      for (const pseudo of ['::before', '::after'] as const) {
        const cs = getComputedStyle(el, pseudo)
        if (cs.getPropertyValue('content') === 'none' || cs.getPropertyValue('content') === 'normal') continue
        elements.push({ path: `${path}${pseudo}`, style: intern(cs) })
      }
      let child = 0
      for (const next of Array.from(el.children)) {
        if (skip.has(next.tagName)) continue
        visit(next, path, child++)
      }
    }
    visit(document.documentElement, '', 0)
    return { props: [...props], styles, elements }
  }, DUMP_PROPS)
}
