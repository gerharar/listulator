import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, loadEnvFile } from './config.js'

describe('loadConfig', () => {
  it('runs with no configuration at all', () => {
    expect(loadConfig({})).toEqual({
      singleUserMode: true,
      databasePath: 'data/listulator.sqlite',
      port: 3001,
      host: '127.0.0.1',
    })
  })

  it('accepts the usual spellings of a boolean', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(loadConfig({ SINGLE_USER_MODE: value }).singleUserMode).toBe(true)
    }
    for (const value of ['0', 'false', 'no', 'off']) {
      expect(loadConfig({ SINGLE_USER_MODE: value }).singleUserMode).toBe(false)
    }
  })

  it('refuses a boolean it cannot understand rather than guessing', () => {
    // Guessing here would silently decide whether the app is multi-tenant.
    expect(() => loadConfig({ SINGLE_USER_MODE: 'maybe' })).toThrow(/boolean/)
  })
})

describe('loadEnvFile', () => {
  let directory: string
  let file: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'listulator-env-'))
    file = join(directory, '.env')
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    delete process.env['LISTULATOR_TEST_VALUE']
  })

  it('reads values out of the file', () => {
    writeFileSync(file, 'LISTULATOR_TEST_VALUE=from-file\n')

    loadEnvFile(file)

    expect(process.env['LISTULATOR_TEST_VALUE']).toBe('from-file')
  })

  it('lets a real environment variable win over the file', () => {
    // An exported value is a deliberate override — a stale .env must not beat
    // what someone just set on the command line.
    process.env['LISTULATOR_TEST_VALUE'] = 'from-shell'
    writeFileSync(file, 'LISTULATOR_TEST_VALUE=from-file\n')

    loadEnvFile(file)

    expect(process.env['LISTULATOR_TEST_VALUE']).toBe('from-shell')
  })

  it('does nothing when there is no file, since one is not required', () => {
    expect(() => loadEnvFile(join(directory, 'absent'))).not.toThrow()
  })
})
