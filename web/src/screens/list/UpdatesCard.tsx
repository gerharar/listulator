import './UpdatesCard.css'
import type { api } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'

type CheckResult = Awaited<ReturnType<typeof api.checkForUpdates>>

export interface UpdatesCardProps {
  result: CheckResult
  /** The "Re-add deleted entries" box: off by default so a rescan respects what you pruned. */
  includeDismissed: boolean
  adding: boolean
  onIncludeDismissedChange: (include: boolean) => void
  onAdd: () => void
}

const NAMED = 12

/**
 * What a check found, in the Check for updates popover: two steps on purpose
 * (a check reports, nothing is written until Add is pressed), because adding
 * automatically would put back everything you deliberately pruned after an
 * import. The layout is mine — the design gives the trigger and the banner,
 * not this card.
 */
export function UpdatesCard({
  result,
  includeDismissed,
  adding,
  onIncludeDismissedChange,
  onAdd,
}: UpdatesCardProps) {
  const text = copy.quantum.list.updates
  const found = result.newItems

  return (
    <div className="q-updates">
      <p className="q-kicker">{text.kicker}</p>
      {found.length === 0 ? (
        <p className="q-updates-line">
          {text.upToDate(result.upstreamCount)}
          {!includeDismissed && result.dismissedCount > 0 && text.heldBack(result.dismissedCount)}
        </p>
      ) : (
        <>
          <p className="q-updates-line">
            <b>{text.foundCount(found.length)}</b>{' '}
            {includeDismissed ? text.foundToPutBack : text.foundNew}
          </p>
          <p className="q-updates-titles">
            {found
              .slice(0, NAMED)
              .map((entry) => entry.title)
              .join(' · ')}
            {found.length > NAMED ? text.andMore(found.length - NAMED) : ''}
          </p>
          <Button variant="primary" size="sm" busy={adding} busyLabel={text.adding} onClick={onAdd}>
            {text.addToList(found.length)}
          </Button>
        </>
      )}
      <label className="q-updates-check">
        <input
          type="checkbox"
          checked={includeDismissed}
          onChange={(event) => onIncludeDismissedChange(event.target.checked)}
        />
        {text.reAddDeleted}
      </label>
    </div>
  )
}
