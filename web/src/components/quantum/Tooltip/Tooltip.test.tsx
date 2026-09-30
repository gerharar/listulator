// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Button, IconButton } from '../Button/Button.js'
import { Tip } from './Tip.js'
import { TOOLTIP_DELAY_MS } from './useTooltip.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const tooltip = () => screen.queryByRole('tooltip')
const wait = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('Tooltip (11.19): the Button family’s own hover text', () => {
  it('replaces the native title: the attribute is gone, the text is the tooltip’s', () => {
    render(<Button title="Explains itself">Go</Button>)

    expect(screen.getByRole('button').hasAttribute('title')).toBe(false)
  })

  it('opens after about half a native delay on hover, and closes as the pointer leaves', async () => {
    render(<Button title="Explains itself">Go</Button>)
    const button = screen.getByRole('button')

    fireEvent.pointerEnter(button, { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS - 50)
    expect(tooltip()).toBeNull()
    await wait(100)
    expect(tooltip()?.textContent).toBe('Explains itself')

    fireEvent.pointerLeave(button)
    await wait(20)
    expect(tooltip()).toBeNull()
  })

  it('opens for keyboard focus too, and Esc closes it', async () => {
    render(<Button title="Explains itself">Go</Button>)

    act(() => screen.getByRole('button').focus())
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()?.textContent).toBe('Explains itself')

    fireEvent.keyDown(document, { key: 'Escape' })
    await wait(20)
    expect(tooltip()).toBeNull()
  })

  it('opens on a disabled button, whose title says why it is disabled', async () => {
    render(
      <Button disabled title="Nothing to add">
        Add
      </Button>,
    )

    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)

    expect(tooltip()?.textContent).toBe('Nothing to add')
  })

  it('shows nothing for a button with no title', async () => {
    render(<Button>Go</Button>)

    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)

    expect(tooltip()).toBeNull()
  })

  it('does not open for a touch', async () => {
    render(<Button title="Explains itself">Go</Button>)

    fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'touch' })
    await wait(TOOLTIP_DELAY_MS + 50)

    expect(tooltip()).toBeNull()
  })

  it('still describes the button to a screen reader while the tooltip is closed', () => {
    render(<Button title="Explains itself">Go</Button>)

    expect(screen.getByRole('button').getAttribute('aria-description')).toBe('Explains itself')
  })

  it('IconButton: its label is the accessible name and the tooltip, with no native title and no double reading', async () => {
    render(
      <IconButton label="Close">
        <span aria-hidden="true">✕</span>
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: 'Close' })

    expect(button.hasAttribute('title')).toBe(false)
    expect(button.hasAttribute('aria-description')).toBe(false)
    fireEvent.pointerEnter(button, { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()?.textContent).toBe('Close')
  })

  it('IconButton: an explicit title is the tooltip, the label stays the name', async () => {
    render(
      <IconButton label="Info" title="What this key is used for">
        i
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: 'Info' })

    fireEvent.pointerEnter(button, { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()?.textContent).toBe('What this key is used for')
  })
})

describe('Tip (11.20): the same tooltip on any element', () => {
  it('draws the element it is asked for, with its own props, and no native title', async () => {
    const onClick = vi.fn()
    render(
      <Tip as="button" type="button" text="Says more" className="chip" aria-label="Chip" onClick={onClick}>
        ●
      </Tip>,
    )
    const chip = screen.getByRole('button', { name: 'Chip' })

    expect(chip.className).toBe('chip')
    expect(chip.hasAttribute('title')).toBe(false)
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledTimes(1)
    fireEvent.pointerEnter(chip, { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()?.textContent).toBe('Says more')
  })

  it('works on a span, and shows nothing without a text', async () => {
    render(
      <>
        <Tip text="On a span" data-testid="a">
          a
        </Tip>
        <Tip text={undefined} data-testid="b">
          b
        </Tip>
      </>,
    )

    fireEvent.pointerEnter(screen.getByTestId('b'), { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()).toBeNull()

    fireEvent.pointerEnter(screen.getByTestId('a'), { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()?.textContent).toBe('On a span')
  })

  it('gives a control its tooltip as a description when asked', () => {
    render(
      <Tip as="button" text="Delete this empty group: it holds no items" aria-label="Delete this empty group" describe>
        x
      </Tip>,
    )

    expect(screen.getByRole('button').getAttribute('aria-description')).toBe('Delete this empty group: it holds no items')
  })

  it('whenClipped: opens only for text that is cut off, not for a name that fits', async () => {
    const size = (element: HTMLElement, scroll: number, client: number) => {
      Object.defineProperty(element, 'scrollWidth', { configurable: true, value: scroll })
      Object.defineProperty(element, 'clientWidth', { configurable: true, value: client })
    }
    render(
      <>
        <Tip text="A very long name indeed" whenClipped data-testid="long">
          A very lo…
        </Tip>
        <Tip text="Short" whenClipped data-testid="short">
          Short
        </Tip>
      </>,
    )
    size(screen.getByTestId('long'), 300, 100)
    size(screen.getByTestId('short'), 100, 100)

    fireEvent.pointerEnter(screen.getByTestId('short'), { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()).toBeNull()

    fireEvent.pointerEnter(screen.getByTestId('long'), { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)
    expect(tooltip()?.textContent).toBe('A very long name indeed')
  })

  it('one at a time: over a Tip inside a Tip, the inner one’s text shows and the outer’s does not', async () => {
    render(
      <Tip text="Outer" data-testid="outer">
        <Tip text="Inner" data-testid="inner">
          x
        </Tip>
      </Tip>,
    )

    fireEvent.pointerEnter(screen.getByTestId('inner'), { pointerType: 'mouse' })
    await wait(TOOLTIP_DELAY_MS + 50)

    expect(screen.getAllByRole('tooltip').map((node) => node.textContent)).toEqual(['Inner'])
  })
})

