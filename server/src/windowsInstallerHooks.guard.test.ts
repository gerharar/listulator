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

  it('write the installer trace only in update mode, and only into the app data folder', () => {
    const writes = text.split('\n').filter((line) => line.includes('FileOpen'))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('$APPDATA\\${BUNDLEID}\\update-installer-trace.txt')
    // Both hooks reach the trace through the update-mode test.
    expect((text.match(/\$\{If\} \$UpdateMode = 1/g) ?? []).length).toBe(2)
  })

  it('touch no file outside that one trace', () => {
    const deletes = text.split('\n').filter((line) => /^\s*(Delete|RMDir|RmDir)\b/.test(line))
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toContain('update-installer-trace.txt')
  })
})
