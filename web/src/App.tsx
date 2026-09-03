import { useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { api, type MediaType } from './lib/api.js'
import { copy } from './locale/index.js'
import { persistTheme, resolveInitialTheme, THEME_KEYS, type ThemeKey } from './lib/theme.js'
import { ListDetail } from './routes/ListDetail.js'
import { NewList } from './routes/NewList.js'
import { Overview } from './routes/Overview.js'
import './styles/base.css'

function useTheme() {
  const [theme, setTheme] = useState<ThemeKey>(() =>
    resolveInitialTheme(
      typeof localStorage === 'undefined' ? undefined : localStorage,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    ),
  )

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    persistTheme(typeof localStorage === 'undefined' ? undefined : localStorage, theme)
  }, [theme])

  return [theme, setTheme] as const
}

/**
 * The shell holds only what does not change while the app is open: the theme
 * and the media-type registry. Lists and list contents are fetched by the
 * routes that show them, so navigating back to a page never displays counts
 * from before the user's last change.
 */
export function App() {
  const [theme, setTheme] = useTheme()
  const [mediaTypes, setMediaTypes] = useState<MediaType[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // /me confirms the server is reachable and the single-user bootstrap ran
    // before anything renders data that depends on it.
    Promise.all([api.me(), api.mediaTypes()])
      .then(([, types]) => setMediaTypes(types))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : copy.app.unknownError),
      )
  }, [])

  return (
    <div className="app">
      <header className="app__header">
        <Link className="app__title" to="/">
          {copy.app.brandLead}
          <span>{copy.app.brandTail}</span>
        </Link>
        <label className="small muted">
          {copy.app.themeLabel}{' '}
          <select
            className="select"
            style={{ width: 'auto', display: 'inline-block' }}
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemeKey)}
          >
            {THEME_KEYS.map((key) => (
              <option key={key} value={key}>
                {copy.themes[key]}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error && <p className="notice notice--error">{error}</p>}

      {!error && !mediaTypes && <p className="muted">{copy.app.loading}</p>}

      {mediaTypes && (
        <Routes>
          <Route path="/" element={<Overview mediaTypes={mediaTypes} />} />
          <Route path="/lists/new" element={<NewList mediaTypes={mediaTypes} />} />
          <Route path="/lists/:listId" element={<ListDetail mediaTypes={mediaTypes} />} />
        </Routes>
      )}
    </div>
  )
}
