// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadText } from './downloadText.js'

afterEach(() => vi.restoreAllMocks())

describe('downloadText', () => {
  it('hands the browser a file of that name and text, then lets the URL go', async () => {
    const created: Blob[] = []
    const revoke = vi.fn()
    URL.createObjectURL = vi.fn((blob: Blob) => (created.push(blob), 'blob:x'))
    URL.revokeObjectURL = revoke
    const clicks: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href })
    })

    downloadText('My list.yaml', 'title: X\n')

    expect(clicks).toEqual([{ download: 'My list.yaml', href: 'blob:x' }])
    expect(await created[0]!.text()).toBe('title: X\n')
    expect(created[0]!.type).toMatch(/yaml|text/)
    expect(revoke).toHaveBeenCalledWith('blob:x')
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
