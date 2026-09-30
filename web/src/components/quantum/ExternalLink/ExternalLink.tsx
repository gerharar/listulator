import { openUrl } from '@tauri-apps/plugin-opener'
import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { isDesktop } from '../../../lib/platform.js'

export interface ExternalLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'target' | 'rel'> {
  href: string
}

/**
 * A link to a page outside the app (task 11.21). In a browser it is a plain
 * new-tab link. In the desktop app the click goes to the system browser
 * through the opener plugin, and the app's own window never navigates: that
 * would replace the whole app with the page. The desktop capability allows
 * only the URLs the app links to (`apps/desktop/src-tauri/capabilities`).
 */
export function ExternalLink({ href, onClick, children, ...rest }: ExternalLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    onClick?.(event)
    if (!isDesktop()) return
    event.preventDefault()
    // A URL the capability does not allow is refused here; say why rather than fail silently.
    openUrl(href).catch((error: unknown) => console.error(`Could not open ${href}`, error))
  }

  return (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
      {children}
    </a>
  )
}
