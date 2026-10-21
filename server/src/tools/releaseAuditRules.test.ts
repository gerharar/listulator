import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  changedAmong,
  codesignFindings,
  codesignProblems,
  compareTrees,
  diffSummary,
  forbiddenPaths,
  formatDiffSummary,
  hasEntitlements,
  machoArchs,
  parseEnvValues,
  plistProblems,
  readTree,
  valueHits,
  WATCHED_PATHS,
} from './releaseAuditRules.js'

/**
 * The parts of `release:audit` (31.10) that need no network, no disk image and no installed tool: what must not be in a release,
 * the owner's `.env` values (found by script, never printed), the app's plist and signature, which processor it is for, whether
 * two copies of the app are the same bytes, and what changed since the last release.
 */

describe('files that must not be in a release', () => {
  it.each([
    ['.env', '.env'],
    ['an .env variant', 'resources/.env.local'],
    ['a database', 'data/listulator.sqlite'],
    ['a database journal', 'data/listulator.sqlite-wal'],
    ['a database by another name', 'x/library.db'],
    ['a source map', 'assets/index-abc123.js.map'],
    ['a curated list folder', 'resources/lists/mcu.yaml'],
    ['a private key', 'keys/updater.key'],
    ['a PEM file', 'cert/server.pem'],
    ['a PKCS12 file', 'cert/app.p12'],
    ['the updater key by its dotted name', '.listulator-updater/key'],
    ['a node_modules folder', 'resources/node_modules/x/index.js'],
    ['a git folder', '.git/config'],
    ['an npm credentials file', 'resources/.npmrc'],
    ['a netrc credentials file', 'home/.netrc'],
    ['an Apple API key', 'keys/AuthKey_ABC123.p8'],
    ['a Java keystore', 'keys/release.jks'],
    ['a Windows path', 'resources\\.env'],
    ['upper case', 'DATA/LISTULATOR.SQLITE'],
  ])('flags %s', (_name, path) => {
    expect(forbiddenPaths([path])).toEqual([path])
  })

  it.each([
    ['the program', 'listulator-desktop.exe'],
    ['the licence', 'LICENSE'],
    ['the third-party notices', 'THIRD-PARTY-NOTICES.txt'],
    ['the app bundle’s plist', 'Listulator.app/Contents/Info.plist'],
    ['a word that only contains "lists"', 'Listulator.app/Contents/Resources/checklists.txt'],
    ['a file called environment', 'Listulator.app/Contents/Resources/environment.txt'],
    ['a public key', 'keys/updater.key.pub.txt'],
  ])('does not flag %s', (_name, path) => {
    expect(forbiddenPaths([path])).toEqual([])
  })

  it('returns only the offenders, in the order given', () => {
    expect(forbiddenPaths(['a.txt', 'b.map', 'c.txt', '.env'])).toEqual(['b.map', '.env'])
  })
})

describe('the owner’s .env values', () => {
  const SECRET = 'S3cr3t-Value-That-Must-Not-Leak-1234'
  const text = ['# a comment', '', `API_KEY=${SECRET}`, 'export OTHER_TOKEN="quoted-value-0987654321"', "SINGLE='single-quoted-value-1'", 'SHORT=abc', 'EMPTY=', 'PORT=3001', 'NOTE=has-a-comment-after-it # and here it is', 'not a line'].join('\n')

  it('reads names and values of 8 or more characters, unquoted, and skips comments, short values and empty ones', () => {
    expect(parseEnvValues(text).map((entry) => entry.name)).toEqual(['API_KEY', 'OTHER_TOKEN', 'SINGLE', 'NOTE'])
    expect(parseEnvValues(text).find((entry) => entry.name === 'OTHER_TOKEN')?.value).toBe('quoted-value-0987654321')
    expect(parseEnvValues(text).find((entry) => entry.name === 'NOTE')?.value).toBe('has-a-comment-after-it')
  })

  it('reads Windows line endings', () => {
    expect(parseEnvValues('A_KEY=abcdefghij\r\nB_KEY=klmnopqrst\r\n').map((entry) => entry.value)).toEqual(['abcdefghij', 'klmnopqrst'])
  })

  it('finds a value in a file as text, and as UTF-16 text (Windows programs hold both), and says which NAME', () => {
    const entries = parseEnvValues(text)

    expect(valueHits(entries, Buffer.from(`xx${SECRET}yy`))).toEqual(['API_KEY'])
    expect(valueHits(entries, Buffer.from(SECRET, 'utf16le'))).toEqual(['API_KEY'])
    expect(valueHits(entries, Buffer.from('nothing to see here'))).toEqual([])
  })

  it('never returns a value: only the names of the entries that were found', () => {
    const hits = valueHits(parseEnvValues(text), Buffer.from(`${SECRET} quoted-value-0987654321`))

    expect(hits).toEqual(['API_KEY', 'OTHER_TOKEN'])
    expect(JSON.stringify(hits)).not.toContain(SECRET)
  })
})

describe('the app’s plist', () => {
  const expected = { identifier: 'com.listulator.desktop', version: '1.1.0', minimumSystemVersion: '11.0' }
  const good = { CFBundleIdentifier: 'com.listulator.desktop', CFBundleShortVersionString: '1.1.0', LSMinimumSystemVersion: '11.0', CFBundleExecutable: 'listulator-desktop' }

  it('has no problems when identifier, version and minimum system are the config’s', () => {
    expect(plistProblems(good, expected)).toEqual([])
  })

  it.each([
    ['another identifier', { CFBundleIdentifier: 'com.example.other' }, /identifier/i],
    ['another version', { CFBundleShortVersionString: '1.0.2' }, /version/i],
    ['another minimum system', { LSMinimumSystemVersion: '10.13' }, /minimum/i],
    ['a camera usage description', { NSCameraUsageDescription: 'to scan' }, /NSCameraUsageDescription/],
    ['a microphone usage description', { NSMicrophoneUsageDescription: 'to hear' }, /NSMicrophoneUsageDescription/],
  ])('reports %s', (_name, change, pattern) => {
    expect(plistProblems({ ...good, ...change }, expected).join('\n')).toMatch(pattern)
  })

  it('reports every problem, one line each', () => {
    const problems = plistProblems({ ...good, CFBundleIdentifier: 'x', CFBundleShortVersionString: 'y' }, expected)

    expect(problems).toHaveLength(2)
    expect(problems.every((line) => !line.includes('\n'))).toBe(true)
  })

  it('says so when the plist is not an object', () => {
    expect(plistProblems(null, expected)).toEqual(['Info.plist is not a dictionary'])
  })
})

describe('which processor a program is for', () => {
  const thin = (cpu: number, subtype = 0) => {
    const buffer = Buffer.alloc(32)
    buffer.writeUInt32LE(0xfeedfacf, 0)
    buffer.writeUInt32LE(cpu, 4)
    buffer.writeUInt32LE(subtype, 8)

    return buffer
  }
  const fat = (...cpus: number[]) => {
    const buffer = Buffer.alloc(8 + cpus.length * 20)
    buffer.writeUInt32BE(0xcafebabe, 0)
    buffer.writeUInt32BE(cpus.length, 4)
    cpus.forEach((cpu, index) => buffer.writeUInt32BE(cpu, 8 + index * 20))

    return buffer
  }

  it('reads a thin arm64 program', () => {
    expect(machoArchs(thin(0x0100000c))).toEqual(['arm64'])
  })

  it('reads a thin x86_64 program', () => {
    expect(machoArchs(thin(0x01000007))).toEqual(['x86_64'])
  })

  it('tells arm64e from arm64', () => {
    expect(machoArchs(thin(0x0100000c, 2))).toEqual(['arm64e'])
  })

  it('reads a universal program, both parts', () => {
    expect(machoArchs(fat(0x01000007, 0x0100000c))).toEqual(['x86_64', 'arm64'])
  })

  it('says nothing for what is not a Mach-O program', () => {
    expect(machoArchs(Buffer.from('MZ this is a Windows program'))).toBeUndefined()
    expect(machoArchs(Buffer.alloc(3))).toBeUndefined()
  })

  it('does not take a Java class file (the same first bytes as a universal program) for one', () => {
    const javaClass = Buffer.alloc(16)
    javaClass.writeUInt32BE(0xcafebabe, 0)
    javaClass.writeUInt32BE(0x00000034, 4)

    expect(machoArchs(javaClass)).toBeUndefined()
  })
})

describe('the app’s code signature', () => {
  const adhoc = ['Executable=/x/Listulator.app/Contents/MacOS/listulator-desktop', 'Identifier=com.listulator.desktop', 'Format=app bundle with Mach-O thin (arm64)', 'CodeDirectory v=20500 size=1234 flags=0x10002(adhoc,runtime) hashes=30+7 location=embedded', 'Signature=adhoc', 'TeamIdentifier=not set'].join('\n')

  it('reads the identifier, the flags, the team and whether it is ad hoc', () => {
    expect(codesignFindings(adhoc)).toEqual({ identifier: 'com.listulator.desktop', flags: '0x10002(adhoc,runtime)', adhoc: true, team: undefined })
  })

  it('reads a Developer ID signature with a team', () => {
    const text = ['Identifier=com.listulator.desktop', 'CodeDirectory v=20500 flags=0x10000(runtime) hashes=1+1', 'Authority=Developer ID Application: Someone (ABCDE12345)', 'TeamIdentifier=ABCDE12345'].join('\n')

    expect(codesignFindings(text)).toMatchObject({ adhoc: false, team: 'ABCDE12345' })
  })

  it('has no problems for an ad hoc signature when the config asks for ad hoc ("-")', () => {
    expect(codesignProblems(codesignFindings(adhoc), { identifier: 'com.listulator.desktop', expectAdhoc: true })).toEqual([])
  })

  it('reports a signature that is not ad hoc when the config asks for ad hoc', () => {
    const findings = { ...codesignFindings(adhoc), adhoc: false, team: 'ABCDE12345' }

    expect(codesignProblems(findings, { identifier: 'com.listulator.desktop', expectAdhoc: true }).join('\n')).toMatch(/ad hoc/i)
  })

  it('reports a signature that is ad hoc when the config names an identity', () => {
    expect(codesignProblems(codesignFindings(adhoc), { identifier: 'com.listulator.desktop', expectAdhoc: false }).join('\n')).toMatch(/ad hoc/i)
  })

  it('reports another identifier', () => {
    expect(codesignProblems(codesignFindings(adhoc), { identifier: 'com.other.app', expectAdhoc: true }).join('\n')).toMatch(/identifier/i)
  })

  it('says an entitlements plist with a key is entitlements, and an empty answer is none', () => {
    expect(hasEntitlements('')).toBe(false)
    expect(hasEntitlements('\n')).toBe(false)
    expect(hasEntitlements('<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>')).toBe(true)
    expect(hasEntitlements('<?xml version="1.0"?><plist version="1.0"><dict></dict></plist>')).toBe(false)
  })
})

describe('whether two copies of an app are the same', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'release-audit-rules-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function app(name: string, files: Record<string, string>, options: { link?: [string, string]; executable?: string } = {}): string {
    const dir = join(root, name)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    if (options.link !== undefined) symlinkSync(options.link[1], join(dir, options.link[0]))
    if (options.executable !== undefined) chmodSync(join(dir, options.executable), 0o755)

    return dir
  }

  const files = { 'Contents/Info.plist': 'plist', 'Contents/MacOS/app': 'binary', 'Contents/Resources/icon.icns': 'icon' }

  it('reads every file with its hash, and symbolic links as links (not followed)', () => {
    const tree = readTree(app('a', files, { link: ['Contents/Frameworks', 'Resources'] }))

    expect([...tree.keys()].sort()).toEqual(['Contents', 'Contents/Frameworks', 'Contents/Info.plist', 'Contents/MacOS', 'Contents/MacOS/app', 'Contents/Resources', 'Contents/Resources/icon.icns'])
    expect(tree.get('Contents/Frameworks')).toEqual({ kind: 'link', target: 'Resources' })
    expect(tree.get('Contents/Info.plist')).toMatchObject({ kind: 'file', size: 5 })
  })

  it('finds no difference between copies with the same files, bytes, links and executable bits', () => {
    const a = readTree(app('a', files, { link: ['Contents/Frameworks', 'Resources'], executable: 'Contents/MacOS/app' }))
    const b = readTree(app('b', files, { link: ['Contents/Frameworks', 'Resources'], executable: 'Contents/MacOS/app' }))

    expect(compareTrees(a, b, 'dmg', 'tar.gz')).toEqual([])
  })

  it('names a file that is only in one copy, in either direction', () => {
    const a = readTree(app('a', { ...files, 'Contents/Resources/extra.bin': 'x' }))
    const b = readTree(app('b', files))

    expect(compareTrees(a, b, 'dmg', 'tar.gz')).toEqual(['only in dmg: Contents/Resources/extra.bin'])
    expect(compareTrees(b, a, 'tar.gz', 'dmg')).toEqual(['only in dmg: Contents/Resources/extra.bin'])
  })

  it('names a file whose bytes differ', () => {
    const a = readTree(app('a', files))
    const b = readTree(app('b', { ...files, 'Contents/MacOS/app': 'binarY' }))

    expect(compareTrees(a, b, 'dmg', 'tar.gz')).toEqual(['differs: Contents/MacOS/app'])
  })

  it('names a file that is executable in one copy only', () => {
    const a = readTree(app('a', files, { executable: 'Contents/MacOS/app' }))
    const b = readTree(app('b', files))

    expect(compareTrees(a, b, 'dmg', 'tar.gz')).toEqual(['differs: Contents/MacOS/app'])
  })

  it('names a link that points elsewhere, and a link that is a file in the other copy', () => {
    const a = readTree(app('a', files, { link: ['Contents/Frameworks', 'Resources'] }))
    const b = readTree(app('b', files, { link: ['Contents/Frameworks', 'Elsewhere'] }))
    const c = readTree(app('c', { ...files, 'Contents/Frameworks': 'a file' }))

    expect(compareTrees(a, b, 'dmg', 'tar.gz')).toEqual(['differs: Contents/Frameworks'])
    expect(compareTrees(a, c, 'dmg', 'tar.gz')).toEqual(['differs: Contents/Frameworks'])
  })
})

describe('what changed since the last release', () => {
  const numstat = ['10\t2\tweb/src/App.tsx', '5\t0\tweb/src/lib/x.ts', '100\t20\tserver/src/catalog/a.ts', '-\t-\tapps/desktop/src-tauri/icons/icon.png', '3\t3\tpackage.json', ''].join('\n')

  it('adds files, insertions and deletions up, binary files counting as files without lines', () => {
    expect(diffSummary(numstat)).toMatchObject({ files: 5, insertions: 118, deletions: 25 })
  })

  it('groups by the first two folders (a file in the root by its own name), most changed lines first', () => {
    expect(diffSummary(numstat).areas.map((area) => [area.area, area.files, area.insertions, area.deletions])).toEqual([
      ['server/src', 1, 100, 20],
      ['web/src', 2, 15, 2],
      ['package.json', 1, 3, 3],
      ['apps/desktop', 1, 0, 0],
    ])
  })

  it('lists at most the number of areas asked for and counts the rest', () => {
    const many = Array.from({ length: 12 }, (_, index) => `${index + 1}\t0\tarea${index}/sub/file.ts`).join('\n')

    const lines = formatDiffSummary(diffSummary(many), 3)

    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('12 files, +78 −0')
    expect(lines[1]).toMatch(/area11\/sub: 1 file, \+12 −0/)
    expect(lines[4]).toBe('  … and 9 more areas')
    expect(formatDiffSummary(diffSummary(many))).toHaveLength(13)
  })

  it('is empty for no change', () => {
    expect(diffSummary('')).toEqual({ files: 0, insertions: 0, deletions: 0, areas: [] })
  })

  it('reads the number of lines as a number even with thousands', () => {
    expect(diffSummary('20578\t945\tx/y/z.ts\n')).toMatchObject({ insertions: 20578, deletions: 945 })
  })

  it('says it in one line, with thousands separators and the real minus sign', () => {
    expect(formatDiffSummary(diffSummary('20578\t945\tx/y/z.ts\n'))[0]).toBe('1 file, +20,578 −945')
    expect(formatDiffSummary(diffSummary(numstat))[0]).toBe('5 files, +118 −25')
  })

  it('names the paths that see the key or the app’s permissions, as watched paths, and says which changed', () => {
    const names = ['web/src/App.tsx', 'package.json', 'apps/desktop/src-tauri/capabilities/default.json', 'server/src/tools/releaseSign.ts', 'server/src/tools/other.ts']

    expect(changedAmong(names, WATCHED_PATHS)).toEqual({
      'server/src/tools': ['server/src/tools/releaseSign.ts', 'server/src/tools/other.ts'],
      'package.json': ['package.json'],
      'apps/desktop/src-tauri/capabilities': ['apps/desktop/src-tauri/capabilities/default.json'],
    })
  })

  it('does not take a path that only starts with the same letters for the watched one', () => {
    expect(changedAmong(['package.json.bak', 'server/src/tools-extra/x.ts'], WATCHED_PATHS)).toEqual({})
  })

  it('watches the tools, the lockfile, the desktop package, the tauri config and the capabilities', () => {
    expect(WATCHED_PATHS).toEqual(expect.arrayContaining(['server/src/tools', 'package.json', 'package-lock.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/capabilities']))
  })
})
