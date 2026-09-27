import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildPlatformTable, parsePlatformsCsv, renderPlatformsModule } from './generatePlatforms.js'

const CSV = 'igdb_id;name;abbreviation\r\n6;Windows;WIN\r\n14;Macintosh;MAC\r\n386;Virtual Reality;VR\r\n471;Virtual Reality;VR\r\n'

describe('parsePlatformsCsv', () => {
  it('reads the owner’s file as saved: semicolons, CRLF, and a BOM when Excel adds one', () => {
    expect(parsePlatformsCsv('﻿' + CSV)).toEqual([
      { igdbId: 6, name: 'Windows', code: 'WIN' },
      { igdbId: 14, name: 'Macintosh', code: 'MAC' },
      { igdbId: 386, name: 'Virtual Reality', code: 'VR' },
      { igdbId: 471, name: 'Virtual Reality', code: 'VR' },
    ])
  })

  it('refuses a file whose header is not exactly igdb_id;name;abbreviation', () => {
    expect(() => parsePlatformsCsv('id;name;code\r\n6;Windows;WIN\r\n')).toThrow(/header/)
  })

  it('refuses a row without exactly three fields, naming the line', () => {
    expect(() => parsePlatformsCsv('igdb_id;name;abbreviation\n6;Windows\n')).toThrow(/line 2/)
  })

  it('refuses quotes (a spreadsheet quoting a field) and a non-numeric id', () => {
    expect(() => parsePlatformsCsv('igdb_id;name;abbreviation\n6;"Windows";WIN\n')).toThrow(/line 2/)
    expect(() => parsePlatformsCsv('igdb_id;name;abbreviation\nsix;Windows;WIN\n')).toThrow(/line 2/)
  })

  it('refuses a code that is not in capitals (codes are shown exactly as written)', () => {
    expect(() => parsePlatformsCsv('igdb_id;name;abbreviation\n200;Amazon Fire TV;FireTV\n')).toThrow(/line 2.*capitals/)
  })

  it('refuses a code of digits only (YAML reads a bare 2600 as a number, so a list file could not use it)', () => {
    expect(() => parsePlatformsCsv('igdb_id;name;abbreviation\n59;Atari 2600;2600\n')).toThrow(/line 2.*2600.*digits/)
  })

  it('refuses a name or code with spaces around it', () => {
    expect(() => parsePlatformsCsv('igdb_id;name;abbreviation\n6;Windows ;WIN\n')).toThrow(/line 2/)
  })
})

describe('buildPlatformTable', () => {
  it('lists each code once, in the order of its first row, with that row’s name; maps every IGDB id', () => {
    const built = buildPlatformTable(parsePlatformsCsv(CSV))

    expect(built.table).toEqual([
      { code: 'WIN', name: 'Windows' },
      { code: 'MAC', name: 'Macintosh' },
      { code: 'VR', name: 'Virtual Reality' },
    ])
    expect(built.igdb).toEqual({ 6: 'WIN', 14: 'MAC', 386: 'VR', 471: 'VR' })
  })

  it('refuses one code with two different names, naming both lines', () => {
    const rows = parsePlatformsCsv('igdb_id;name;abbreviation\n7;PlayStation;PS1\n441;PS One;PS1\n')

    expect(() => buildPlatformTable(rows)).toThrow(/PS1.*line 2.*line 3/)
  })

  it('refuses the same code written two ways, and a duplicate IGDB id', () => {
    expect(() => buildPlatformTable(parsePlatformsCsv('igdb_id;name;abbreviation\n7;PlayStation;PS1\n8;PlayStation;ps1\n'))).toThrow(/ps1/i)
    expect(() => buildPlatformTable(parsePlatformsCsv('igdb_id;name;abbreviation\n7;A;A\n7;B;B\n'))).toThrow(/7/)
  })
})

describe('the committed table', () => {
  it('is exactly what config/platforms.csv generates (run npm run platforms:generate -w server after editing it)', () => {
    const csv = readFileSync(fileURLToPath(new URL('../../../config/platforms.csv', import.meta.url)), 'utf8')
    const committed = readFileSync(fileURLToPath(new URL('../catalog/platforms.generated.ts', import.meta.url)), 'utf8')

    expect(committed).toBe(renderPlatformsModule(buildPlatformTable(parsePlatformsCsv(csv))))
  })
})
