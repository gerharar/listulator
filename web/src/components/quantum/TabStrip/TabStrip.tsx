import './TabStrip.css'

export interface TabStripTab {
  key: string
  label: string
}

/**
 * design-system/components/TabStrip — 2 to 4 tabs on a header's 2px
 * rule, the active tab a solid accent block. Switching tabs is the
 * caller's job (`onChange`); clearing whatever transient state a tab
 * held is the caller's responsibility too (README: "the Import buffer
 * never survives a leave").
 */
export interface TabStripProps {
  tabs: TabStripTab[]
  active: string
  onChange: (key: string) => void
}

export function TabStrip({ tabs, active, onChange }: TabStripProps) {
  return (
    <div className="q-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.key} role="tab" aria-selected={tab.key === active} onClick={() => onChange(tab.key)}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
