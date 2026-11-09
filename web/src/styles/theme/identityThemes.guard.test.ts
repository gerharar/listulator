import { describe, expect, it } from 'vitest'
import { THEMES } from '../../../e2e-tools/identity/themes'
import { EXZED_SKINS } from '../../lib/preferences/exzedSkins'

/**
 * The identity tool's list of themes (Phase 49.14). eX-Zed is registered with exactly the app's six skin keys and the preferences that select it, so a skin
 * added to the app and not to the tool, or the other way round, fails here instead of going unmeasured. The tool itself runs by hand (it needs browsers).
 */
describe('the identity tool’s themes', () => {
  it('knows Quantum and eX-Zed', () => {
    expect(Object.keys(THEMES)).toEqual(['quantum', 'exzed'])
  })

  it('captures eX-Zed in the six skins the app has, in the app’s order', () => {
    expect(THEMES['exzed']!.skins).toEqual([...EXZED_SKINS])
  })

  it('selects eX-Zed with the theme preference and sets the skin it is capturing under eX-Zed’s own key, never Quantum’s', () => {
    expect(THEMES['exzed']!.seed).toEqual({ theme: 'exzed' })
    expect(THEMES['exzed']!.skinKey).toBe('exzedSkin')
  })

  it('leaves Quantum’s capture exactly as it was: five skins, no preference, the key `skin`', () => {
    expect(THEMES['quantum']).toEqual({ skins: ['dark-orange', 'dark-green', 'dark-blue', 'dark-violet', 'light-bone'], seed: {}, skinKey: 'skin' })
  })
})
