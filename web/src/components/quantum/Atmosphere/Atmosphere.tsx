import './Atmosphere.css'

/**
 * The fixed field behind the app shell: a wash, two grids, a coprime
 * hatch, two rings and a ruler (design-system/components/Atmosphere,
 * ported verbatim from bundle.css). Fixed at "rich" (Q4) — there's no
 * preference and no Settings control for it. `prefers-reduced-transparency:
 * reduce` drops it to the plain treatment automatically, in
 * `Atmosphere.css` alone; no JS media-query handling needed.
 */
export function Atmosphere() {
  return (
    <div className="q-atmo" aria-hidden="true">
      <i className="wash" />
      <i className="fine" />
      <i className="coarse" />
      <i className="hatch" />
      <i className="ring1" />
      <i className="ring2" />
      <i className="ruler" />
    </div>
  )
}
