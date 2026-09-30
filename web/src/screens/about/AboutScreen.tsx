import './AboutScreen.css'
import { useState, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { APP_VERSION } from '../../lib/appVersion.js'
import { Button, IconButton } from '../../components/quantum/Button/Button.js'
import { ExternalLink } from '../../components/quantum/ExternalLink/ExternalLink.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import { ABOUT_SOURCES, AUTHOR, TMDB_NOTICE, type AboutSource } from '../../lib/dataSources.js'
import tmdbLogo from './tmdb-long.svg'

/**
 * The About layer (task 11.21; design handoff `docs/design/about-screen/`,
 * plate right seed 6). The same shell as Settings: a header bar and a
 * scrolling body. Check for updates is a placeholder until the desktop
 * updater exists (owner, 2026-09-30), so it is disabled and says so.
 */
export function AboutScreen() {
  const layerStack = useLayerStack()
  const text = copy.quantum.about

  return (
    <div className="q-about">
      <div className="q-about-head">
        <HeaderPlate side="right" seed={6} />
        <h1 className="q-about-title">{text.title}</h1>
        <IconButton label={text.closeLabel} onClick={() => layerStack.pop()}>
          <X width={17} height={17} strokeWidth={1.9} aria-hidden="true" />
        </IconButton>
      </div>

      <div className="q-about-body">
        <div className="q-about-column">
          <section className="q-about-identity">
            <div className="q-about-nameline">
              <span className="q-about-name">Listulator</span>
              <span className="q-about-version">{`${text.version} ${APP_VERSION}`}</span>
            </div>
            <div className="q-about-update">
              <Button variant="primary" size="sm" disabled title={text.updatesLater}>
                {text.checkForUpdates}
              </Button>
            </div>
            <div className="q-about-legal">
              <p className="q-about-author">
                <span>
                  {text.madeBy} <b>{AUTHOR.handle}</b>
                </span>
                <ExternalLink className="q-about-link" href={AUTHOR.repoUrl}>
                  {AUTHOR.repoLabel}
                  <span aria-hidden="true">↗</span>
                </ExternalLink>
              </p>
              <p>{text.licence}</p>
              <p>{text.listsLicence}</p>
              <p>{text.dataTerms}</p>
            </div>
          </section>

          <section>
            <h2 className="q-kicker section q-about-kicker">{text.dataSources}</h2>
            <ul className="q-about-sources">
              {ABOUT_SOURCES.map((source) =>
                source.key === 'tmdb' ? <TmdbRow key={source.key} source={source} /> : <SourceRow key={source.key} source={source} />,
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

function SourceLink({ source }: { source: AboutSource }) {
  return (
    <ExternalLink className="q-about-link" href={source.url} onClick={(event) => event.stopPropagation()}>
      {source.host}
      <span aria-hidden="true">↗</span>
    </ExternalLink>
  )
}

function SourceRow({ source }: { source: AboutSource }) {
  return (
    <li className="q-about-source">
      <span className="q-about-source-name">{source.name}</span>
      <span className="q-about-source-powers">{copy.quantum.about.powers[source.key]}</span>
      <SourceLink source={source} />
    </li>
  )
}

/**
 * TMDB's row folds out its attribution: the logo and the notice its terms
 * require. Open from the start (owner: the notice must be seen, not found).
 * The whole row toggles it; its links and the open panel do not.
 */
function TmdbRow({ source }: { source: AboutSource }) {
  const text = copy.quantum.about
  const [open, setOpen] = useState(true)
  const keep = (event: MouseEvent) => event.stopPropagation()

  return (
    <li className={`q-about-source q-about-tmdb${open ? ' open' : ''}`} onClick={() => setOpen((was) => !was)}>
      <Tip
        as="button"
        type="button"
        className="q-about-source-name q-about-toggle"
        aria-expanded={open}
        text={open ? text.hideAttribution : text.showAttribution}
      >
        <span className="q-about-chevron" aria-hidden="true">
          ▸
        </span>
        {source.name}
      </Tip>
      <span className="q-about-source-powers">{text.powers[source.key]}</span>
      <SourceLink source={source} />
      {open && (
        <div className="q-about-attribution" onClick={keep}>
          <ExternalLink className="q-about-logo" href={source.url}>
            <img src={tmdbLogo} width={182} height={24} alt="The Movie Database (TMDB)" />
          </ExternalLink>
          <p lang="en">{TMDB_NOTICE}</p>
        </div>
      )}
    </li>
  )
}
