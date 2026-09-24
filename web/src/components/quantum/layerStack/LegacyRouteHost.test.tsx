// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { LegacyRouteHost } from './LegacyRouteHost.js'

afterEach(cleanup)

function Inner() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  return (
    <div>
      <span>id={id}</span>
      <Link to="/">home</Link>
      <button onClick={() => navigate(`/lists/${id}`, { replace: true })}>replace</button>
    </div>
  )
}

describe('LegacyRouteHost', () => {
  it('resolves useParams against the frozen path, not the real browser URL', () => {
    render(
      <LegacyRouteHost path="/lists/42" onNavigate={vi.fn()}>
        <Routes>
          <Route path="/lists/:id" element={<Inner />} />
        </Routes>
      </LegacyRouteHost>,
    )

    expect(screen.getByText('id=42')).not.toBeNull()
  })

  it('a Link click calls onNavigate rather than changing window.location', () => {
    const onNavigate = vi.fn()
    const before = window.location.pathname
    render(
      <LegacyRouteHost path="/lists/42" onNavigate={onNavigate}>
        <Routes>
          <Route path="/lists/:id" element={<Inner />} />
        </Routes>
      </LegacyRouteHost>,
    )

    screen.getByText('home').click()

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/', { replace: false })
    expect(window.location.pathname).toBe(before)
  })

  it('navigate(to, { replace: true }) is reported as a replace', () => {
    const onNavigate = vi.fn()
    render(
      <LegacyRouteHost path="/lists/42" onNavigate={onNavigate}>
        <Routes>
          <Route path="/lists/:id" element={<Inner />} />
        </Routes>
      </LegacyRouteHost>,
    )

    screen.getByText('replace').click()

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/lists/42', { replace: true })
  })

  it('two LegacyRouteHosts can coexist as siblings, each resolving its own params — the "two-step peek" case', () => {
    render(
      <div>
        <LegacyRouteHost path="/lists/1" onNavigate={vi.fn()}>
          <Routes>
            <Route path="/lists/:id" element={<Inner />} />
          </Routes>
        </LegacyRouteHost>
        <LegacyRouteHost path="/lists/2" onNavigate={vi.fn()}>
          <Routes>
            <Route path="/lists/:id" element={<Inner />} />
          </Routes>
        </LegacyRouteHost>
      </div>,
    )

    expect(screen.getByText('id=1')).not.toBeNull()
    expect(screen.getByText('id=2')).not.toBeNull()
  })
})
