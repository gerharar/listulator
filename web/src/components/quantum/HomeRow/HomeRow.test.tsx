// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeRow } from './HomeRow.js'
import { TimeLeftProvider } from '../Home/TimeLeftSetting.js'
import { hoverTooltip } from '../Tooltip/hoverTooltip.js'

afterEach(cleanup)

describe('HomeRow', () => {
  it('shows the title, the percentage and the count in parentheses (H-024: “41% (25/60)”)', () => {
    render(
      <HomeRow
        title="Breaking Bad"
        description={null}
        mark={null}
        status={null}
        done={25}
        total={60}
        minutesLeft={420}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText('Breaking Bad')).not.toBeNull()
    const cluster = document.querySelector('.q-home-cluster') as HTMLElement
    expect(cluster.querySelector('.q-pct')?.textContent).toBe('41%')
    expect(cluster.querySelector('.q-home-count')?.textContent).toBe('(25/60)')
    expect(cluster.querySelector('.q-meter')?.nextElementSibling).toBe(cluster.querySelector('.q-pct'))
    expect(cluster.querySelector('.q-pct')?.classList.contains('full')).toBe(false)
  })

  it('shows no time left on the row, whatever the list (H-024: it is estimated, partial or missing)', () => {
    const row = (done: number, total: number, extra = {}) => (
      <HomeRow title="A" description={null} mark={null} status={null} done={done} total={total} minutesLeft={420} onOpen={vi.fn()} {...extra} />
    )
    // What a screen reader hears (the row's name ends with the time) is not on the screen: only the visible text is read here.
    const visible = (pattern: RegExp) => screen.queryAllByText(pattern).filter((node) => !node.classList.contains('q-home-sr'))

    render(row(3, 10))
    expect(visible(/left/)).toHaveLength(0)

    cleanup()
    render(row(10, 10))
    expect(visible(/All Done/)).toHaveLength(0)

    cleanup()
    render(row(3, 10, { runtimesPending: 4 }))
    expect(visible(/≈/)).toHaveLength(0)
  })

  it('reads 100% in gold, with a full bar, when every item is done', () => {
    render(<HomeRow title="A" description={null} mark={null} status={null} done={4} total={4} minutesLeft={0} onOpen={vi.fn()} />)

    expect(document.querySelector('.q-pct')?.textContent).toBe('100%')
    expect(document.querySelector('.q-pct')?.classList.contains('full')).toBe(true)
    expect(document.querySelector('.q-meter')?.classList.contains('full')).toBe(true)
  })

  it('reads “0%” with 20 empty cells on an empty list (owner, 2026-10-31)', () => {
    render(<HomeRow title="A" description={null} mark={null} status={null} done={0} total={0} minutesLeft={0} onOpen={vi.fn()} />)

    expect(document.querySelector('.q-pct')?.textContent).toBe('0%')
    expect((document.querySelector('.q-meter') as HTMLElement).style.getPropertyValue('--f')).toBe('0')
  })

  describe('the time left, on hover or keyboard focus of the bar, percentage and count (H-024)', () => {
    const props = { title: 'Pixar', description: null, mark: null, status: null, onOpen: vi.fn() } as const
    const cluster = () => document.querySelector('.q-home-cluster') as HTMLElement

    it('says how long is left', async () => {
      render(<HomeRow {...props} done={3} total={10} minutesLeft={35 * 60} />)

      expect(await hoverTooltip(cluster())).toBe('35h left')
    })

    it('marks an estimate, and says how many lengths are still being looked up', async () => {
      render(<HomeRow {...props} done={0} total={100} minutesLeft={12000} runtimesPending={40} />)

      expect(await hoverTooltip(cluster())).toBe('≈200h left · Looking up runtimes: 40 still to go')
    })

    it('says “All Done” on a finished list, “Done (for now)” on one that is still going, “Empty list” on an empty one', async () => {
      render(<HomeRow {...props} done={4} total={4} minutesLeft={0} />)
      expect(await hoverTooltip(cluster())).toBe('All Done')

      cleanup()
      render(<HomeRow {...props} status="ongoing" done={4} total={4} minutesLeft={0} />)
      expect(await hoverTooltip(cluster())).toBe('Done (for now)')

      cleanup()
      render(<HomeRow {...props} done={0} total={0} minutesLeft={0} />)
      expect(await hoverTooltip(cluster())).toBe('Empty list')
    })

    it('stays quiet while the pointer is on the title: the tooltip belongs to the cluster', async () => {
      render(<HomeRow {...props} done={3} total={10} minutesLeft={600} />)

      expect(await hoverTooltip(document.querySelector('.q-home-row .name') as HTMLElement)).toBeNull()
    })

    it('shows at once when keyboard focus reaches the row, and goes when it leaves', () => {
      render(<HomeRow {...props} done={3} total={10} minutesLeft={35 * 60} />)
      const button = screen.getByRole('button')
      // jsdom cannot tell keyboard focus from a mouse press's (what it says depends on the tests that ran before); say it is the keyboard's.
      const matches = button.matches.bind(button)
      button.matches = (selector: string) => selector === ':focus-visible' || matches(selector)

      act(() => button.focus())
      expect(screen.getByRole('tooltip').textContent).toBe('35h left')

      act(() => button.blur())
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('ends the row’s accessible name with the time, since the tooltip is for the pointer', () => {
      render(<HomeRow {...props} done={3} total={10} minutesLeft={35 * 60} />)
      expect(screen.getByRole('button').textContent).toMatch(/\(3\/10\), 35h left$/)

      cleanup()
      render(<HomeRow {...props} done={4} total={4} minutesLeft={0} />)
      expect(screen.getByRole('button').textContent).toMatch(/\(4\/4\), All Done$/)

      cleanup()
      render(<HomeRow {...props} done={0} total={0} minutesLeft={0} />)
      expect(screen.getByRole('button').textContent).toMatch(/\(0\/0\)$/)
    })

    it('opens the list on a click anywhere on the row, the cluster included', () => {
      const onOpen = vi.fn()
      render(<HomeRow {...props} onOpen={onOpen} done={3} total={10} minutesLeft={600} />)

      fireEvent.click(cluster().querySelector('.q-pct')!)
      expect(onOpen).toHaveBeenCalledOnce()
    })
  })

  it('the whole row is one button that opens the list', () => {
    const onOpen = vi.fn()
    render(
      <HomeRow
        title="Breaking Bad"
        description={null}
        mark={null}
        status={null}
        done={0}
        total={10}
        minutesLeft={600}
        onOpen={onOpen}
      />,
    )

    screen.getByRole('button').click()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('puts the description on the name group as a tooltip, never a second line', async () => {
    render(
      <HomeRow
        title="Breaking Bad"
        description="The Vince Gilligan one."
        mark={null}
        status={null}
        done={0}
        total={10}
        minutesLeft={600}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.queryByText('The Vince Gilligan one.')).toBeNull()
    const name = document.querySelector('.q-home-row .name') as HTMLElement
    expect(name.textContent).toContain('Breaking Bad')
    expect(await hoverTooltip(name)).toBe('The Vince Gilligan one.')
  })

  it('shows the curated star for a canonical list, and nothing for an unmarked one', () => {
    const { rerender } = render(
      <HomeRow
        title="A"
        description={null}
        mark="curated"
        status={null}
        done={0}
        total={1}
        minutesLeft={10}
        onOpen={vi.fn()}
      />,
    )
    expect(document.querySelector('.q-star')).not.toBeNull()
    expect(document.querySelector('.q-byhand')).toBeNull()

    rerender(
      <HomeRow
        title="A"
        description={null}
        mark={null}
        status={null}
        done={0}
        total={1}
        minutesLeft={10}
        onOpen={vi.fn()}
      />,
    )
    expect(document.querySelector('.q-star')).toBeNull()
  })

  it('shows the by-hand mark for a manual list', () => {
    render(
      <HomeRow
        title="A"
        description={null}
        mark="byHand"
        status={null}
        done={0}
        total={1}
        minutesLeft={10}
        onOpen={vi.fn()}
      />,
    )
    expect(document.querySelector('.q-byhand')).not.toBeNull()
  })

  it('shows a status mark only when the source made a claim', () => {
    const { rerender } = render(
      <HomeRow
        title="A"
        description={null}
        mark={null}
        status="ongoing"
        done={0}
        total={1}
        minutesLeft={10}
        onOpen={vi.fn()}
      />,
    )
    expect(document.querySelector('.q-status-mark')).not.toBeNull()

    rerender(
      <HomeRow
        title="A"
        description={null}
        mark={null}
        status={null}
        done={0}
        total={1}
        minutesLeft={10}
        onOpen={vi.fn()}
      />,
    )
    expect(document.querySelector('.q-status-mark')).toBeNull()
  })

  describe('the N NEW badge', () => {
    const row = (newCount?: number) => (
      <HomeRow
        title="Star Wars"
        description={null}
        mark={null}
        status={null}
        done={0}
        total={10}
        minutesLeft={600}
        {...(newCount === undefined ? {} : { newCount })}
        onOpen={vi.fn()}
      />
    )

    it('shows how many items are new', () => {
      render(row(3))

      expect(screen.getByText('3 NEW')).not.toBeNull()
    })

    it('puts the badge in a column of its own beside the name, not inside it (H-024: title · NEW · bar and % · count)', () => {
      render(row(3))
      const badge = screen.getByText('3 NEW')

      expect(badge.parentElement).toBe(document.querySelector('.q-home-row'))
      expect(badge.closest('.name')).toBeNull()
    })

    it('shows nothing when none are new, or when the count is not known', () => {
      render(row(0))
      expect(screen.queryByText(/NEW/)).toBeNull()

      cleanup()
      render(row())
      expect(screen.queryByText(/NEW/)).toBeNull()
    })
  })

  /** The setting "Show time left in My Lists" (H-024, owner 2026-10-31): the column comes back, and the tooltip it would repeat is off. */
  describe('with Show time left in My Lists on', () => {
    const props = { title: 'Pixar', description: null, mark: null, status: null, onOpen: vi.fn() } as const
    const withTime = (node: React.ReactElement) => render(<TimeLeftProvider on>{node}</TimeLeftProvider>)
    const time = () => document.querySelector('.q-home-row > .q-left') as HTMLElement | null

    it('draws the time left as a cell of its own, after the cluster', () => {
      withTime(<HomeRow {...props} done={3} total={10} minutesLeft={35 * 60} />)

      expect(time()?.textContent).toBe('35h left')
      expect(document.querySelector('.q-home-cluster')?.nextElementSibling).toBe(time())
      expect(time()?.classList.contains('all-done')).toBe(false)
    })

    it('marks an estimate, and says on hover of the time how many lengths are still being looked up', async () => {
      withTime(<HomeRow {...props} done={0} total={100} minutesLeft={12000} runtimesPending={40} />)

      expect(time()?.textContent).toBe('≈200h left')
      expect(await hoverTooltip(time()!)).toBe('Looking up runtimes: 40 still to go')
    })

    it('reads ✓ All Done on a finished list and ✓ Done (for now) on one still going, as the all-done chip', () => {
      withTime(<HomeRow {...props} done={4} total={4} minutesLeft={0} />)
      expect(time()?.textContent).toBe('✓ All Done')
      expect(time()?.classList.contains('all-done')).toBe(true)

      cleanup()
      withTime(<HomeRow {...props} status="ongoing" done={4} total={4} minutesLeft={0} />)
      expect(time()?.textContent).toBe('✓ Done (for now)')
    })

    it('has no time cell on an empty list', () => {
      withTime(<HomeRow {...props} done={0} total={0} minutesLeft={0} />)

      expect(time()).toBeNull()
    })

    it('has no tooltip on the cluster, on hover or on keyboard focus: it would repeat the column', async () => {
      withTime(<HomeRow {...props} done={3} total={10} minutesLeft={35 * 60} />)
      const button = screen.getByRole('button')
      const matches = button.matches.bind(button)
      button.matches = (selector: string) => selector === ':focus-visible' || matches(selector)

      expect(await hoverTooltip(document.querySelector('.q-home-cluster') as HTMLElement)).toBeNull()
      act(() => button.focus())
      expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('has no screen-reader suffix: the column is read as it is, once', () => {
      withTime(<HomeRow {...props} done={3} total={10} minutesLeft={35 * 60} />)

      expect(document.querySelector('.q-home-sr')).toBeNull()
      expect(screen.getByRole('button').textContent?.match(/35h left/g)).toHaveLength(1)
    })
  })
})
