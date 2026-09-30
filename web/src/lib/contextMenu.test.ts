// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { installContextMenuGuard } from './contextMenu.js'

let uninstall: (() => void) | undefined
afterEach(() => {
  uninstall?.()
  uninstall = undefined
  document.body.innerHTML = ''
})

/** Right-clicks `element`; true when the browser's own menu would have been allowed to open. */
function rightClick(element: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)

  return !event.defaultPrevented
}

function page(html: string): void {
  document.body.innerHTML = html
}

describe('installContextMenuGuard: no browser menu ("Inspect Element") on the app’s own UI', () => {
  it('blocks a right-click on plain content, buttons, rows and icons', () => {
    uninstall = installContextMenuGuard()
    page('<div id="row"><button id="b"><svg id="icon"></svg></button><span id="t">text</span></div>')

    for (const id of ['row', 'b', 'icon', 't']) expect(rightClick(document.getElementById(id)!), id).toBe(false)
  })

  it('leaves the menu on for typing fields, where cut, copy and paste are wanted', () => {
    uninstall = installContextMenuGuard()
    page('<input id="a" type="text"><textarea id="b"></textarea><input id="c" type="search"><div id="d" contenteditable="true"><b id="e">x</b></div>')

    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(rightClick(document.getElementById(id)!), id).toBe(true)
  })

  it('still blocks it on inputs that take no typing: checkboxes, files, buttons', () => {
    uninstall = installContextMenuGuard()
    page('<input id="a" type="checkbox"><input id="b" type="file"><input id="c" type="button">')

    for (const id of ['a', 'b', 'c']) expect(rightClick(document.getElementById(id)!), id).toBe(false)
  })

  it('stops blocking once it is uninstalled', () => {
    const remove = installContextMenuGuard()
    page('<div id="x"></div>')
    remove()

    expect(rightClick(document.getElementById('x')!)).toBe(true)
  })
})
