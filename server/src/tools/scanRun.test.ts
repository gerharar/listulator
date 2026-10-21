import { describe, expect, it } from 'vitest'
import { hasNoArtifacts, unexpectedFiles } from './scanRun.js'

describe('unexpectedFiles', () => {
  const expected = ['a_setup.exe', 'b_setup.exe', 'b_setup.exe.sig', 'latest.json']

  it('says nothing when the artifact holds exactly the expected files, in any order and in any folder level', () => {
    expect(unexpectedFiles(['latest.json', 'b_setup.exe.sig', 'a_setup.exe', 'b_setup.exe'], expected)).toEqual([])
    expect(unexpectedFiles(['artifact-name/latest.json', 'artifact-name/a_setup.exe', 'artifact-name/b_setup.exe', 'artifact-name/b_setup.exe.sig'], expected)).toEqual([])
  })

  it('names a file that is not on the list, however harmless it looks', () => {
    expect(unexpectedFiles([...expected, 'notes.txt'], expected)).toEqual(['unexpected file: notes.txt'])
    expect(unexpectedFiles([...expected, 'x/updater-test-run.key'], expected)).toEqual(['unexpected file: x/updater-test-run.key'])
  })

  it('names a file that is missing', () => {
    expect(unexpectedFiles(['a_setup.exe', 'b_setup.exe', 'latest.json'], expected)).toEqual(['missing file: b_setup.exe.sig'])
  })

  it('names both problems', () => {
    expect(unexpectedFiles(['a_setup.exe', 'other.bin'], ['a_setup.exe', 'latest.json'])).toEqual(['unexpected file: other.bin', 'missing file: latest.json'])
  })
})

describe('hasNoArtifacts', () => {
  it('knows the message gh prints for a run that uploaded nothing (the canary uploads nothing, on purpose)', () => {
    expect(hasNoArtifacts('no valid artifacts found to download')).toBe(true)
    expect(hasNoArtifacts('Command failed: gh run download 1\nno valid artifacts found to download\n')).toBe(true)
  })

  it('does not take any other failure for an empty run (a network error must not read as "nothing to scan")', () => {
    expect(hasNoArtifacts('HTTP 502: Bad Gateway')).toBe(false)
    expect(hasNoArtifacts('could not find any workflow run')).toBe(false)
    expect(hasNoArtifacts('')).toBe(false)
  })
})
