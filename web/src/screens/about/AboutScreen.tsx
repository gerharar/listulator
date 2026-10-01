import './AboutScreen.css'
import { useEffect, useState, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { appUpdateChecker, type AppUpdateChecker } from '../../lib/appUpdate.js'
import { APP_VERSION } from '../../lib/appVersion.js'
import { useUpdateCheck } from '../../lib/useUpdateCheck.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { ExternalLink } from '../../components/quantum/ExternalLink/ExternalLink.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'
import { useLiveRegion } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import { ABOUT_SOURCES, AUTHOR, LICENSING_URL, TMDB_NOTICE, type AboutSource } from '../../lib/dataSources.js'
import tmdbLogo from './tmdb-long.svg'
import { UpdateBlock, updateStatusText, updateVersionText } from './UpdateBlock.js'

/**
 * The About layer (task 11.21; design handoff `docs/design/about-screen/`,
 * plate right seed 6). The same shell as Settings: a header bar and a
 * scrolling body. Check for updates is a placeholder until the desktop
 * updater exists (owner, 2026-09-30), so it is disabled and says so.
 */
export function AboutScreen({ checker }: { checker?: AppUpdateChecker }) {
  const layerStack = useLayerStack()
  const { announce } = useLiveRegion()
  const text = copy.quantum.about
  // Made once per opening: a new checker on every render would start a new check on every render.
  const [used] = useState(() => checker ?? appUpdateChecker())
  const update = useUpdateCheck(used)

  // Each answer is spoken once, with the version; "Checking…" and "no updater yet" are not answers. (The
  // block's `role="status"` is also a live region: if a screen reader then says it twice, drop the role.)
  useEffect(() => {
    if (update.state === 'latest' || update.state === 'available' || update.state === 'error') {
      announce(`${updateStatusText(update.state)} ${updateVersionText(APP_VERSION, update.state === 'available' ? update.next : undefined)}`)
    }
  }, [update.state, update.next, announce])

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
            </div>
            <UpdateBlock
              state={update.state}
              current={APP_VERSION}
              {...(update.next === undefined ? {} : { next: update.next })}
              onCheck={() => void update.check()}
              onDownload={update.download}
            />
            <p className="q-about-credits">
              <span>{AUTHOR.copyright}</span>
              <span className="q-about-sep" aria-hidden="true">
                ·
              </span>
              <ExternalLink className="q-about-credit-link" href={AUTHOR.repoUrl}>
                {AUTHOR.githubLabel}
                <span aria-hidden="true">↗</span>
              </ExternalLink>
              <span className="q-about-sep" aria-hidden="true">
                ·
              </span>
              <ExternalLink className="q-about-credit-link" href={LICENSING_URL}>
                {text.legal}
                <span aria-hidden="true">↗</span>
              </ExternalLink>
            </p>
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
