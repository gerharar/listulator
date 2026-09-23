import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Self-hosted rather than loaded from a font CDN: this app is meant to be
// self-hosted and to work offline as a PWA, and it shouldn't leak visits to a
// third party. Quantum (Phase 10, task 10.3, D8) needs Inter 300/800 beyond
// the weights already loaded here, and JetBrains Mono for every mono token
// (`--font-mono`, `web/src/styles/quantum/tokens.css`).
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import { App } from './App.js'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('#root not found')

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
