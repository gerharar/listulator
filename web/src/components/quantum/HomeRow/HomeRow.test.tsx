// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeRow } from './HomeRow.js'

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

  it('puts the description on the name group as a native tooltip, never a second line', () => {
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
    expect(screen.getByTitle('The Vince Gilligan one.').textContent).toContain('Breaking Bad')
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
})
