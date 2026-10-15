// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Field } from './Field.js'
import { FieldMessage } from './FieldMessage.js'
import { useFieldValidation } from './useFieldValidation.js'

afterEach(cleanup)

/**
 * H-006 (owner, 2026-10-15): one rule for every form. A field is checked on leaving it (when it holds something) and on
 * submit, never per keystroke; once its sentence shows it follows the value; a submit with a bad field saves nothing, marks
 * every bad field and puts the cursor on the first.
 */
const TITLE_SENTENCE = 'An item needs a title'
const MINUTES_SENTENCE = 'Use minutes (95)'

function Form({ onSubmit }: { onSubmit: (ok: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('')
  const checks = useFieldValidation({
    title: { value: title, problem: (value) => (value.trim() === '' ? TITLE_SENTENCE : null) },
    minutes: { value: minutes, problem: (value) => (value === '' || /^\d+$/.test(value) ? null : MINUTES_SENTENCE) },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(checks.validate())
      }}
    >
      <Field label="Title" value={title} onChange={(event) => setTitle(event.target.value)} {...checks.props('title')} />
      {checks.message('title')}
      <Field label="Minutes" value={minutes} onChange={(event) => setMinutes(event.target.value)} {...checks.props('minutes')} />
      {checks.message('minutes')}
      <button type="submit">Save</button>
      <button type="button" onClick={checks.reset}>
        Forget
      </button>
    </form>
  )
}

const title = () => screen.getByLabelText('Title') as HTMLInputElement
const minutes = () => screen.getByLabelText('Minutes') as HTMLInputElement
const type = (field: HTMLInputElement, value: string) => fireEvent.change(field, { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

describe('FieldMessage', () => {
  it('is an alert with one sentence and an icon the screen reader skips', () => {
    const { container } = render(<FieldMessage id="m1" text="Use four digits" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveProperty('id', 'm1')
    expect(alert.textContent).toBe('Use four digits')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('useFieldValidation', () => {
  it('shows nothing before the first blur or submit, whatever is typed', () => {
    render(<Form onSubmit={vi.fn()} />)

    type(minutes(), 'abc')

    expect(screen.queryByRole('alert')).toBeNull()
    expect(minutes().getAttribute('aria-invalid')).toBeNull()
  })

  it('checks a field when it is left, and marks it and points at its sentence', () => {
    render(<Form onSubmit={vi.fn()} />)

    type(minutes(), 'abc')
    fireEvent.blur(minutes())

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(MINUTES_SENTENCE)
    expect(minutes().getAttribute('aria-invalid')).toBe('true')
    expect(minutes().getAttribute('aria-describedby')).toBe(alert.id)
  })

  it('does not check an empty field on blur, even one that cannot be empty', () => {
    render(<Form onSubmit={vi.fn()} />)

    fireEvent.blur(title())

    expect(screen.queryByRole('alert')).toBeNull()
    expect(title().getAttribute('aria-invalid')).toBeNull()
  })

  it('leaves a good field alone on blur', () => {
    render(<Form onSubmit={vi.fn()} />)

    type(minutes(), '95')
    fireEvent.blur(minutes())

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('follows the value once shown: the sentence goes when it is valid and comes back when it is not', () => {
    render(<Form onSubmit={vi.fn()} />)
    type(minutes(), 'abc')
    fireEvent.blur(minutes())

    type(minutes(), '95')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(minutes().getAttribute('aria-invalid')).toBeNull()
    expect(minutes().getAttribute('aria-describedby')).toBeNull()

    type(minutes(), '95x')
    expect(screen.getByRole('alert').textContent).toBe(MINUTES_SENTENCE)
  })

  describe('on submit', () => {
    it('says whether every field is good, and marks none when they are', () => {
      const onSubmit = vi.fn()
      render(<Form onSubmit={onSubmit} />)
      type(title(), 'Glorious Purpose')

      save()

      expect(onSubmit).toHaveBeenCalledWith(true)
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('marks every bad field, empty ones included, and says no', () => {
      const onSubmit = vi.fn()
      render(<Form onSubmit={onSubmit} />)
      type(minutes(), 'abc')

      save()

      expect(onSubmit).toHaveBeenCalledWith(false)
      expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([TITLE_SENTENCE, MINUTES_SENTENCE])
      expect(title().getAttribute('aria-invalid')).toBe('true')
      expect(minutes().getAttribute('aria-invalid')).toBe('true')
    })

    it('puts the cursor on the first bad field, in the order given, with its text selected', () => {
      render(<Form onSubmit={vi.fn()} />)
      type(minutes(), 'abc')

      save()

      expect(document.activeElement).toBe(title())

      type(title(), 'Glorious Purpose')
      save()

      expect(document.activeElement).toBe(minutes())
      expect([minutes().selectionStart, minutes().selectionEnd]).toEqual([0, 3])
    })

    it('does not check a field twice for the same blur and submit: one sentence per field', () => {
      render(<Form onSubmit={vi.fn()} />)
      type(minutes(), 'abc')
      fireEvent.blur(minutes())

      save()

      expect(screen.getAllByRole('alert')).toHaveLength(2)
    })
  })

  it('hides every sentence when reset, and shows them again only after the next blur or submit', () => {
    render(<Form onSubmit={vi.fn()} />)
    save()
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Forget' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(title().getAttribute('aria-invalid')).toBeNull()
  })
})
