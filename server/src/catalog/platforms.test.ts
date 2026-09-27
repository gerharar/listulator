import { describe, expect, it } from 'vitest'
import fixture from '../ingestion/adapters/igdbPlatforms.fixture.json' with { type: 'json' }
import { igdbPlatformCode, LEGACY_PLATFORM_TAGS, PLATFORM_ORDER, platformCode, platformKey, platformName } from './platforms.js'

describe('the platform table (config/platforms.csv, 10.24c)', () => {
  it('follows the file’s order, and holds only the table’s platforms (no MULTI claim: owner, U5)', () => {
    expect(PLATFORM_ORDER[0]).toBe('win')
    expect(PLATFORM_ORDER).not.toContain('multi')
    expect(new Set(PLATFORM_ORDER).size).toBe(PLATFORM_ORDER.length)
    expect(PLATFORM_ORDER.indexOf('a2600')).toBeGreaterThan(PLATFORM_ORDER.indexOf('win'))
  })

  it('maps every platform IGDB has (recorded 2026-09-27) to a code', () => {
    const unmapped = fixture.filter((platform) => igdbPlatformCode(platform.id) === undefined)

    expect(unmapped).toEqual([])
    expect(igdbPlatformCode(6)).toBe('WIN')
    // Atari's consoles carry a letter: a code of digits alone is a number to YAML (owner, 2026-09-27).
    expect([59, 66, 60].map(igdbPlatformCode)).toEqual(['A2600', 'A5200', 'A7800'])
  })
})

describe('reading a tag', () => {
  it('matches a code whatever its case', () => {
    expect(platformKey('win')).toBe('win')
    expect(platformKey(' Win ')).toBe('win')
  })

  it('reads the digits-only Atari codes the table used before as today’s codes', () => {
    expect(['2600', '5200', '7800', 'atari2600'].map(platformCode)).toEqual(['A2600', 'A5200', 'A7800', 'A2600'])
    expect(platformName('2600')).toBe('Atari 2600')
  })

  it('no old tag it translates is itself a code in the table', () => {
    expect(Object.keys(LEGACY_PLATFORM_TAGS).filter((tag) => PLATFORM_ORDER.includes(tag))).toEqual([])
  })

  it('reads the codes written before the table as today’s: PC is WIN, NDS is DS', () => {
    expect(platformKey('PC')).toBe('win')
    expect(platformKey('NDS')).toBe('ds')
    expect(platformKey('SWITCH')).toBe('nsw')
    expect(platformKey('GENESIS/MEGADRIVE')).toBe('gen')
    expect(platformName('PC')).toBe('Windows')
  })

  it('shows a code in the file’s capitals, and an unknown tag (a bare multi too) in capitals', () => {
    expect(platformCode('pc')).toBe('WIN')
    expect(platformCode('firetv')).toBe('FIRETV')
    expect(platformCode('multi')).toBe('MULTI')
    expect(platformCode('Some Console')).toBe('SOME CONSOLE')
  })

  it('has a full name only for a known code', () => {
    expect(platformName('X360')).toBe('Xbox 360')
    expect(platformName('multi')).toBeNull()
    expect(platformName('Some Console')).toBeNull()
  })
})
