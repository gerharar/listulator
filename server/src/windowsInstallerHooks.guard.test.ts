import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The Windows installer's hooks (BL-092, docs/DECISIONS.md "Windows update: installer hooks"). NSIS is compiled only on the
 * release runner, so a typo here would first show up in a release build: these checks hold what can be held without one.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TAURI_DIR = `${REPO_ROOT}apps/desktop/src-tauri/`
const config = JSON.parse(readFileSync(`${TAURI_DIR}tauri.conf.json`, 'utf8')) as {
  bundle: { windows?: { nsis?: { installerHooks?: string } } }
}

describe('the installer hooks', () => {
  const hooksPath = config.bundle.windows?.nsis?.installerHooks

  it('are named in tauri.conf.json and the file is there', () => {
    expect(hooksPath).toBeDefined()
    expect(existsSync(`${TAURI_DIR}${hooksPath}`)).toBe(true)
  })

  const text = hooksPath === undefined ? '' : readFileSync(`${TAURI_DIR}${hooksPath}`, 'utf8')

  it('define the two macros the template calls', () => {
    expect(text).toMatch(/^!macro NSIS_HOOK_PREINSTALL$/m)
    expect(text).toMatch(/^!macro NSIS_HOOK_POSTINSTALL$/m)
  })

  it('are ASCII, so the compiler reads them the same in any code page', () => {
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[^\x00-\x7f]/)
  })

  it('have every macro closed, and every If', () => {
    expect((text.match(/^!macro /gm) ?? []).length).toBe((text.match(/^!macroend$/gm) ?? []).length)
    expect((text.match(/\$\{If(?:Not)?\}\s/g) ?? []).length).toBe((text.match(/\$\{EndIf\}/g) ?? []).length)
  })

  it('write only the two trace files, and only where the app data folder already is', () => {
    const opens = text.split('\n').filter((line) => line.includes('FileOpen'))
    expect(opens).toHaveLength(2)
    expect(opens[0]).toContain('$APPDATA\\${BUNDLEID}\\update-installer-trace.txt')
    expect(opens[1]).toContain('$APPDATA\\${BUNDLEID}\\update-installer-trace-end.txt')
    // Each write sits inside the test for the folder, so a fresh install creates nothing.
    expect((text.match(/\$\{If\} \$\{FileExists\} "\$APPDATA\\\$\{BUNDLEID\}\\\*\.\*"/g) ?? []).length).toBe(2)
  })

  it('delete and remove nothing', () => {
    expect(text.split('\n').filter((line) => /^\s*(Delete|RMDir|RmDir)\b/.test(line))).toEqual([])
  })

  it('leave the stack as it found it: as many Pop as Push', () => {
    expect((text.match(/^\s*Push /gm) ?? []).length).toBe((text.match(/^\s*Pop /gm) ?? []).length - (text.match(/^\s*Pop \$\{reg\}$/gm) ?? []).length)
  })
})
