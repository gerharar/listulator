import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  VERSION_SOURCES,
  isReleaseVersion,
  versionProblems,
  withVersion,
  type RepoFiles,
} from './versionSources.js'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Every file a version is written in, as the real repository has it right now. */
function realFiles(): RepoFiles {
  const files: RepoFiles = {}
  for (const file of new Set(VERSION_SOURCES.map((source) => source.file))) {
    files[file] = readFileSync(`${REPO_ROOT}${file}`, 'utf8')
  }
  return files
}

describe('isReleaseVersion', () => {
  it.each(['1.0.0', '0.1.0', '1.0.0-rc.1', '1.0.0-rc.12', '2.10.3-beta.2'])('accepts %s', (version) => {
    expect(isReleaseVersion(version)).toBe(true)
  })

  it.each(['1.0', '1', 'v1.0.0', '01.0.0', '1.0.0-', '1.0.0-rc.01', '1.0.0+build.5', '1.0.0 ', ''])(
    'refuses %j',
    (version) => {
      expect(isReleaseVersion(version)).toBe(false)
    },
  )
})

describe('withVersion', () => {
  it('writes the version into every source and leaves the rest of each file as it was', () => {
    const before = realFiles()
    const after = withVersion(before, '9.8.7-rc.3')

    for (const source of VERSION_SOURCES) {
      expect(source.read(after[source.file]!), source.label).toBe('9.8.7-rc.3')
    }
    // Only the version lines differ: the same number of lines, and every other line is identical.
    for (const file of Object.keys(before)) {
      const was = before[file]!.split('\n')
      const now = after[file]!.split('\n')
      expect(now.length, file).toBe(was.length)
      expect(now.filter((line, index) => line !== was[index]).every((line) => line.includes('9.8.7-rc.3')), file).toBe(true)
    }
  })

  it('is a no-op when the files already carry that version (so the formatting is preserved byte for byte)', () => {
    const before = realFiles()
    const current = VERSION_SOURCES[0]!.read(before[VERSION_SOURCES[0]!.file]!)

    expect(withVersion(before, current)).toEqual(before)
  })

  it('refuses a version that is not a release version, and changes nothing', () => {
    expect(() => withVersion(realFiles(), 'v1.0.0')).toThrow(/not a version/)
  })
})

describe('versionProblems', () => {
  it('finds none in a set of files that agree', () => {
    expect(versionProblems(withVersion(realFiles(), '1.0.0-rc.1'))).toEqual([])
  })

  it.each(VERSION_SOURCES.map((source) => [source.label, source] as const))(
    'names the copy that disagrees: %s',
    (label, source) => {
      const files = withVersion(realFiles(), '1.0.0-rc.1')
      // Change only this one copy.
      files[source.file] = source.write(files[source.file]!, '1.0.0-rc.2')

      const problems = versionProblems(files)

      // The source of truth itself disagreeing with all the rest names every other copy instead.
      expect(problems.length).toBeGreaterThan(0)
      expect(problems.join('\n')).toContain(label === VERSION_SOURCES[0]!.label ? VERSION_SOURCES[1]!.label : label)
    },
  )

  it('refuses a source of truth that is not a version', () => {
    const files = withVersion(realFiles(), '1.0.0')
    files['package.json'] = VERSION_SOURCES[0]!.write(files['package.json']!, 'latest')

    expect(versionProblems(files).join('\n')).toMatch(/not a version/)
  })

  it('says so when a version cannot be found in a file at all', () => {
    const files = withVersion(realFiles(), '1.0.0')
    files['apps/desktop/src-tauri/Cargo.toml'] = '[package]\nname = "listulator-desktop"\n'

    expect(versionProblems(files).join('\n')).toMatch(/Cargo\.toml.*no version/)
  })
})
