import './AboutScreen.css'
import { X } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { HeaderPlate } from '../../components/quantum/HeaderPlate/HeaderPlate.js'
import { useLayerStack } from '../../components/quantum/layerStack/LayerStackContext.js'

/**
 * The About layer (task 11.21; design handoff `docs/design/about-screen/`,
 * plate right seed 6). The same shell as Settings: a header bar and a
 * scrolling body.
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
        <div className="q-about-column" />
      </div>
    </div>
  )
}
