// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeRow } from './HomeRow.js'
import { hoverTooltip } from '../Tooltip/hoverTooltip.js'

afterEach(cleanup)

describe('HomeRow', () => {
  it('shows the title, count, and time left', () => {
    render(
      <HomeRow
        title="Breaking Bad"
        description={null}
        mark={null}
        status={null}
        done={3}
        total={10}
        minutesLeft={420}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText('Breaking Bad')).not.toBeNull()
    expect(screen.getByText('3/10 (30%)')).not.toBeNull()
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

    it('shows nothing when none are new, or when the count is not known', () => {
      render(row(0))
      expect(screen.queryByText(/NEW/)).toBeNull()

      cleanup()
      render(row())
      expect(screen.queryByText(/NEW/)).toBeNull()
    })
  })

  it('marks the time left as approximate while lengths are still being looked up (15.7), and not otherwise', () => {
    const props = { title: 'Pixar', description: null, mark: null, status: null, done: 0, total: 100, minutesLeft: 12000, onOpen: vi.fn() } as const
    render(<HomeRow {...props} runtimesPending={40} />)

    expect(screen.getByText('≈ 200h left')).not.toBeNull()

    cleanup()
    render(<HomeRow {...props} />)

    expect(screen.getByText('200h left')).not.toBeNull()
  })
})
