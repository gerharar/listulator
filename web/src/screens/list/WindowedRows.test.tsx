// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import type { ListGroup, ListItem } from '../../lib/api.js'
import { buildRowModel, GROUP_HEIGHT, ITEM_HEIGHT, type ShownUnit } from './rowModel.js'
import { WindowedRows } from './WindowedRows.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const item = (id: string): ListItem => ({ id, title: id }) as ListItem
const loose = (id: string): ShownUnit => ({ unit: { kind: 'item', item: item(id) }, members: [] })
const block = (id: string, count: number): ShownUnit => {
  const members = Array.from({ length: count }, (_, n) => item(`${id}.${n}`))
  return { unit: { kind: 'group', group: { id, name: id } as ListGroup, items: members } as ShownUnit['unit'], members }
}

/** jsdom has no layout: the scroller's height is given, and `scrollTop` is set on the element and announced with a scroll event. */
function mount(shown: ShownUnit[], options: { height?: number; enabled?: boolean; pinned?: string[]; shut?: string[]; heights?: { itemHeight: number; groupHeight: number } } = {}) {
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(options.height ?? 460)
  const scroller = createRef<HTMLDivElement>()
  const shut = new Set(options.shut ?? [])
  const model = buildRowModel(shown, (name) => shut.has(name), options.heights)
  const tree = (pinned: string[]) => (
    <div ref={scroller} data-testid="scroller" style={{ overflowY: 'auto' }}>
      <WindowedRows
        shown={shown}
        model={model}
        enabled={options.enabled ?? true}
        pinned={new Set(pinned)}
        scroller={scroller}
        renderItem={(entry: ListItem, grouped: boolean): ReactNode => (
          <div key={entry.id} className={grouped ? 'q-item in-group' : 'q-item'} data-row-id={entry.id} />
        )}
        renderGroup={({ unit }, rows): ReactNode =>
          unit.kind === 'group' ? (
            <div key={unit.group.id} className="q-list-block">
              <div className="q-group" data-row-id={unit.group.id} />
              {rows}
            </div>
          ) : null
        }
      />
    </div>
  )
  const view = render(tree(options.pinned ?? []))

  return {
    ...view,
    model,
    scroller: view.container.querySelector('[data-testid="scroller"]') as HTMLDivElement,
    pin: (pinned: string[]) => view.rerender(tree(pinned)),
    ids: () => [...view.container.querySelectorAll('[data-row-id]')].map((node) => (node as HTMLElement).dataset['rowId']!),
    spacerHeights: () => [...view.container.querySelectorAll('.q-list-spacer')].map((node) => Number.parseInt((node as HTMLElement).style.height, 10)),
    scrollTo: async (top: number) => {
      const scroll = view.container.querySelector('[data-testid="scroller"]') as HTMLDivElement
      Object.defineProperty(scroll, 'scrollTop', { value: top, configurable: true, writable: true })
      await act(async () => {
        scroll.dispatchEvent(new Event('scroll'))
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      })
    },
  }
}

describe('WindowedRows (Phase 25.2)', () => {
  it('draws only the rows near the top of a long list, and a spacer for all the rest, so the scroll height is the whole list', () => {
    const { ids, spacerHeights, model } = mount(Array.from({ length: 1000 }, (_, n) => loose(`r${n}`)))

    // 460px of window plus 460px of overscan below: ids r0 to r19, and nothing above to draw.
    expect(ids().length).toBeGreaterThan(9)
    expect(ids().length).toBeLessThan(40)
    expect(ids()[0]).toBe('r0')
    expect(ids()).not.toContain('r999')
    expect(spacerHeights()).toHaveLength(1)
    expect(spacerHeights()[0]! + ids().length * ITEM_HEIGHT).toBe(model.total)
  })

  it('draws every row, with no spacer at all, for a list under the threshold or with virtualization off', () => {
    const small = mount(Array.from({ length: 150 }, (_, n) => loose(`s${n}`)), { enabled: false })
    expect(small.ids()).toHaveLength(150)
    expect(small.spacerHeights()).toEqual([])
    cleanup()

    const off = mount(Array.from({ length: 5000 }, (_, n) => loose(`o${n}`)), { enabled: false })
    expect(off.ids()).toHaveLength(5000)
    expect(off.spacerHeights()).toEqual([])
  })

  it('follows the scroll: the window moves, and what was left behind is spaced, not drawn', async () => {
    const { ids, scrollTo, spacerHeights, model } = mount(Array.from({ length: 1000 }, (_, n) => loose(`r${n}`)))

    await scrollTo(20_000)

    // 20,000 / 46 is row 434.
    expect(ids()).toContain('r434')
    expect(ids()).not.toContain('r0')
    expect(ids()).not.toContain('r999')
    expect(spacerHeights()).toHaveLength(2)
    expect(spacerHeights().reduce((sum, height) => sum + height, 0) + ids().length * ITEM_HEIGHT).toBe(model.total)
  })

  it('keeps a group as one block with its header while any of it is in view, and spaces the members that are not drawn', async () => {
    const shown = [loose('a'), block('G', 800), loose('z')]
    const { container, ids, scrollTo, model } = mount(shown)

    await scrollTo(ITEM_HEIGHT + GROUP_HEIGHT + 400 * ITEM_HEIGHT)

    expect(container.querySelectorAll('.q-list-block')).toHaveLength(1)
    const blockEl = container.querySelector('.q-list-block') as HTMLElement
    expect(blockEl.firstElementChild!.className).toBe('q-group')
    expect(ids()).toContain('G.400')
    expect(ids()).not.toContain('G.0')
    expect(ids()).not.toContain('a')
    // The block is as tall as the whole group: its header, its drawn rows and its two spacers.
    const spacers = [...blockEl.querySelectorAll('.q-list-spacer')].map((node) => Number.parseInt((node as HTMLElement).style.height, 10))
    const rows = blockEl.querySelectorAll('.q-item').length
    expect(GROUP_HEIGHT + rows * ITEM_HEIGHT + spacers.reduce((sum, height) => sum + height, 0)).toBe(model.units[1]!.height)
  })

  it('keeps a pinned row drawn after it has scrolled far out of the window, and lets it go when it is unpinned', async () => {
    const { ids, pin, scrollTo } = mount(Array.from({ length: 1000 }, (_, n) => loose(`r${n}`)), { pinned: ['r3'] })
    await scrollTo(30_000)
    expect(ids()).toContain('r3')
    expect(ids()).toContain('r652')

    pin([])

    expect(ids()).not.toContain('r3')
  })

  it('draws a shut group as its header alone, however long the group is', () => {
    const { ids } = mount([block('G', 5000), loose('z')], { shut: ['G'] })

    expect(ids()).toEqual(['G', 'z'])
  })

  it('does not draw 50,000 rows while it is waiting to know how tall its scroller is', () => {
    // The first render, before anything is measured, uses a default window: not the whole list.
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(0)
    const shown = Array.from({ length: 50_000 }, (_, n) => loose(`r${n}`))
    const scroller = createRef<HTMLDivElement>()
    const model = buildRowModel(shown, () => false)
    const view = render(
      <div ref={scroller}>
        <WindowedRows shown={shown} model={model} enabled pinned={new Set()} scroller={scroller} renderItem={(entry) => <div key={entry.id} className="q-item" />} renderGroup={() => null} />
      </div>,
    )

    expect(view.container.querySelectorAll('.q-item').length).toBeLessThan(80)
  })
})

describe("WindowedRows at the Preview's heights (Phase 26.1)", () => {
  it('draws rows of 40px: the spacer and the drawn rows add up to the model, and the window follows a scroll in whole 40px rows', async () => {
    const heights = { itemHeight: 40, groupHeight: 40 }
    const { ids, spacerHeights, model, scrollTo } = mount(Array.from({ length: 1000 }, (_, n) => loose(`r${n}`)), { heights })

    expect(model.total).toBe(40_000)
    expect(spacerHeights()[0]! + ids().length * 40).toBe(40_000)

    await scrollTo(10_015)

    // 10,015 is read as 10,000 (row 250): the row at the top of the window is drawn, those 460px of overscan above are drawn, row 0 is not.
    expect(ids()).toContain('r250')
    expect(ids()).not.toContain('r0')
    expect(spacerHeights().reduce((sum, height) => sum + height, 0) + ids().length * 40).toBe(40_000)
  })
})
