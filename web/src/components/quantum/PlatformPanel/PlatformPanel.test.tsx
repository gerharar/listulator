// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PlatformPanel } from './PlatformPanel.js'

afterEach(cleanup)

const picker = { subject: 'Halo', selected: [] as string[], onChange: () => {}, inList: [] as string[] }

describe('PlatformPanel (11.3)', () => {
  it('is not mounted until the element it sits beside exists: nothing is drawn at the left edge', () => {
    render(<PlatformPanel reference={null} {...picker} />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mounts beside its reference', () => {
    const reference = document.body.appendChild(document.createElement('div'))
    render(<PlatformPanel reference={reference} {...picker} />)

    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
