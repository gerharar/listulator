import { describe, expect, it } from 'vitest'
import { quitPlatform } from './appQuit.js'

describe('quitPlatform (16.2b)', () => {
  it('reads a Mac from the webview user agent', () => {
    expect(
      quitPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'),
    ).toBe('mac')
  })

  it('reads anything else as other (Windows WebView2)', () => {
    expect(
      quitPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      ),
    ).toBe('other')
  })
})
