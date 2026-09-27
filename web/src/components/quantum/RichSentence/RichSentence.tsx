import { Fragment } from 'react'
import type { RichText } from '../../../locale/types.js'

/** Renders a locale `RichText`: plain runs as text, `{ strong }` runs bold in the same font. */
export function RichSentence({ parts }: { parts: RichText }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {typeof part === 'string' ? part : <strong>{part.strong}</strong>}
        </Fragment>
      ))}
    </>
  )
}
