import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Runner } from './releaseSign.js'
import { createAuditHost, parseReleaseAuditArguments, releaseAudit, type AuditHost } from './releaseAudit.js'

/**
 * `npm run release:audit -- <tag>` (31.10): the scripted audit of a release's files, a draft or a published one, that the owner's
 * routine did by hand (step 4). Tested against a fake host that REALLY writes the files an installer, an archive and a disk image
 * would unpack to, so the tree reading, the comparison and the scans run for real; only the programs (`7zz`, `hdiutil`, `codesign`,
 * `gh`, `git`) are faked. What the tests pin: every finding is a failure line that never holds a secret, and the disk image is
 * always unmounted.
 */

const VERSION = '1.1.0'
const TAG = `v${VERSION}`
const PREVIOUS = 'v1.0.2'
const COMMIT = 'a'.repeat(40)
const PREVIOUS_COMMIT = 'b'.repeat(40)
const EXE = `Listulator_${VERSION}_x64-setup.exe`
const DMG = `Listulator_${VERSION}_aarch64.dmg`
const TAR = 'Listulator.app.tar.gz'
const SUMS = 'SHA256SUMS'
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const SECRET = 'Sup3r-Secret-Value-From-The-Env-File-9876'

/** A thin arm64 Mach-O header followed by some bytes; enough for the audit to read which processor the program is for. */
function machO(cpu = 0x0100000c, extra = 'program'): Buffer {
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(cpu, 4)

  return Buffer.concat([header, Buffer.from(extra)])
}

type Files = Record<string, string | Buffer>

const goodApp = (): Files => ({
  'Contents/Info.plist': 'plist',
  'Contents/MacOS/listulator-desktop': machO(),
  'Contents/Resources/icon.icns': 'icon',
})

interface World {
  assets: string[]
  files: Record<string, Buffer>
  localTags: string[]
  commits: Record<string, string | Error>
  config: unknown
  attested: (name: string, tag: string, commit: string) => boolean
  windows: Files
  tarApp: Files
  dmgApp: Files
  plist: unknown
  verifies: (where: 'dmg' | 'tar') => { ok: boolean; output: string }
  signature: string
  entitlements: string
  numstat: string
  names: string[]
  unpackFails: boolean
  mountFails: boolean
  unmountFails: boolean
}

function world(over: Partial<World> = {}): World {
  const files: Record<string, Buffer> = {
    [EXE]: Buffer.from('the windows installer'.repeat(50)),
    [DMG]: Buffer.from('the disk image'.repeat(50)),
    [TAR]: Buffer.from('the app archive'.repeat(50)),
  }
  files[SUMS] = Buffer.from(Object.entries(files).map(([name, data]) => `${sha(data)}  ${name}\n`).join(''))

  return {
    assets: [EXE, DMG, TAR, SUMS],
    files,
    localTags: ['v1.0.0', 'v1.0.1', PREVIOUS, TAG, 'v1.0.0-rc.1'],
    commits: { [TAG]: COMMIT, [PREVIOUS]: PREVIOUS_COMMIT },
    config: { identifier: 'com.listulator.desktop', bundle: { macOS: { signingIdentity: '-', minimumSystemVersion: '11.0' } } },
    attested: (_name, t, commit) => commit === (t === TAG ? COMMIT : PREVIOUS_COMMIT),
    windows: { 'listulator-desktop.exe': 'MZ program', 'uninstall.exe': 'MZ uninstaller', LICENSE: 'licence', 'NOTICE.md': 'notice', 'THIRD-PARTY-NOTICES.txt': 'notices' },
    tarApp: goodApp(),
    dmgApp: goodApp(),
    plist: { CFBundleIdentifier: 'com.listulator.desktop', CFBundleShortVersionString: VERSION, LSMinimumSystemVersion: '11.0', CFBundleExecutable: 'listulator-desktop' },
    verifies: () => ({ ok: true, output: '' }),
    signature: ['Identifier=com.listulator.desktop', 'CodeDirectory v=20500 flags=0x10002(adhoc,runtime) hashes=1+1', 'Signature=adhoc', 'TeamIdentifier=not set'].join('\n'),
    entitlements: '',
    numstat: '10\t2\tweb/src/App.tsx\n5\t1\tserver/src/catalog/a.ts\n3\t3\tpackage.json\n',
    names: ['web/src/App.tsx', 'server/src/catalog/a.ts', 'package.json'],
    unpackFails: false,
    mountFails: false,
    unmountFails: false,
    ...over,
  }
}

function write(root: string, files: Files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

interface Fake {
  host: AuditHost
  calls: string[]
  mountPoints: string[]
  dirs: string[]
}

function fake(w: World): Fake {
  const out: Fake = { calls: [], mountPoints: [], dirs: [], host: undefined as unknown as AuditHost }
  out.host = {
    viewRelease: async () => ({ isDraft: true, assets: w.assets }),
    download: async (_tag, names, dir) => {
      out.dirs.push(dir)
      for (const name of names) {
        const data = w.files[name]
        if (data === undefined) throw new Error(`no such asset ${name}`)
        writeFileSync(join(dir, name), data)
      }
    },
    verifyAttestation: async (file, tag, commit) => w.attested(file.split('/').at(-1)!, tag, commit),
    tagCommit: async (tag) => {
      const commit = w.commits[tag]
      if (commit === undefined) throw new Error(`The tag ${tag} is not in this clone: run git fetch --tags`)
      if (commit instanceof Error) throw commit

      return commit
    },
    localTags: async () => w.localTags,
    tagConfig: async () => w.config,
    diffNumstat: async () => w.numstat,
    diffNames: async () => w.names,
    unpackInstaller: async (_file, dir) => {
      out.calls.push('unpack')
      if (w.unpackFails) throw new Error('7zz: cannot open the file as an archive')
      write(dir, w.windows)
    },
    extractArchive: async (_file, dir) => {
      out.calls.push('extract')
      write(join(dir, 'Listulator.app'), w.tarApp)
    },
    mountDisk: async (_file, mountPoint) => {
      out.calls.push('mount')
      out.mountPoints.push(mountPoint)
      if (w.mountFails) throw new Error('hdiutil: attach failed')
      write(join(mountPoint, 'Listulator.app'), w.dmgApp)
      symlinkSync('/Applications', join(mountPoint, 'Applications'))
    },
    unmountDisk: async (mountPoint) => {
      out.calls.push('unmount')
      if (w.unmountFails) throw new Error('hdiutil: resource busy')
      for (const entry of readdirSync(mountPoint)) rmSync(join(mountPoint, entry), { recursive: true, force: true })
    },
    plist: async () => w.plist,
    codesignVerify: async (app) => w.verifies(app.includes('release-audit-mnt') ? 'dmg' : 'tar'),
    codesignDetails: async () => w.signature,
    entitlements: async () => w.entitlements,
  }

  return out
}

async function audit(w: World, options: { envText?: string } = {}) {
  const f = fake(w)
  const log: string[] = []
  const notes: string[] = []
  const result = await releaseAudit({ tag: TAG, ...options }, f.host, (line) => log.push(line), (line) => notes.push(line))

  return { ...f, result, log, notes }
}

const everything = (r: { result: { failures: string[] }; log: string[]; notes: string[] }) => [...r.result.failures, ...r.log, ...r.notes].join('\n')

describe('a release that is as it should be', () => {
  it('has no failures', async () => {
    const { result } = await audit(world(), { envText: `API_KEY=${SECRET}\n` })

    expect(result).toEqual({ tag: TAG, failures: [] })
  })

  it('says what it checked, in the order of the routine', async () => {
    const { log } = await audit(world(), { envText: `API_KEY=${SECRET}\n` })
    const text = log.join('\n')

    expect(text).toMatch(/SHA256SUMS/)
    expect(text).toMatch(/built by this repository's release workflow/)
    expect(text).toMatch(/refused with the commit of v1\.0\.2/)
    expect(text).toMatch(/Windows installer unpacked: 5 files/)
    expect(text).toMatch(/the app in the disk image and in Listulator\.app\.tar\.gz are the same/i)
    expect(text).toMatch(/com\.listulator\.desktop/)
    expect(text).toMatch(/arm64/)
    expect(text).toMatch(/codesign --verify --deep --strict/)
    expect(text).toMatch(/1 \.env value.* in 0 of \d+ files|\.env.*0 of \d+ files/)
  })

  it('works for a published release as well as a draft (it reads the same files)', async () => {
    const w = world()
    const f = fake(w)
    f.host.viewRelease = async () => ({ isDraft: false, assets: [...w.assets, `${EXE}.sig`, `${TAR}.sig`, 'latest.json'] })

    const result = await releaseAudit({ tag: TAG }, f.host, () => undefined, () => undefined)

    expect(result.failures).toEqual([])
  })

  it('reads the expectations from the tagged config, not from constants (another identifier, an identity, another minimum)', async () => {
    const w = world({
      config: { identifier: 'com.example.other', bundle: { macOS: { signingIdentity: 'Developer ID Application: X', minimumSystemVersion: '12.0' } } },
    })

    const { result } = await audit(w)
    const text = result.failures.join('\n')

    expect(text).toMatch(/CFBundleIdentifier/)
    expect(text).toMatch(/LSMinimumSystemVersion/)
    expect(text).toMatch(/ad hoc/i)
  })

  it('unmounts the disk image, removes its mount point and leaves no work folder behind', async () => {
    const { calls, mountPoints, dirs } = await audit(world())

    expect(calls).toEqual(expect.arrayContaining(['mount', 'unmount']))
    expect(calls.indexOf('mount')).toBeLessThan(calls.indexOf('unmount'))
    expect(mountPoints.every((path) => !existsSync(path))).toBe(true)
    expect(dirs.every((path) => !existsSync(path))).toBe(true)
  })
})

describe('what is wrong with the release’s files', () => {
  it('fails an unexpected file in the release, and a required one that is missing', async () => {
    const extra = await audit(world({ assets: [EXE, DMG, TAR, SUMS, 'secrets.zip'] }))
    const missing = await audit(world({ assets: [EXE, TAR, SUMS] }))

    expect(extra.result.failures.some((line) => /secrets\.zip/.test(line) && /nobody expected/.test(line))).toBe(true)
    expect(missing.result.failures.some((line) => line.includes(DMG) && /lacks/.test(line))).toBe(true)
  })

  it('fails a file that does not match SHA256SUMS', async () => {
    const w = world()
    w.files[EXE] = Buffer.from('a changed installer')

    const { result } = await audit(w)

    expect(result.failures.some((line) => line.includes(EXE) && /SHA256SUMS/.test(line))).toBe(true)
  })

  it('fails a SHA256SUMS that does not list exactly the three files', async () => {
    const w = world()
    w.files[SUMS] = Buffer.from(w.files[SUMS]!.toString().split('\n').slice(0, 1).join('\n') + '\n')

    const { result } = await audit(w)

    expect(result.failures.some((line) => /SHA256SUMS does not list exactly/.test(line))).toBe(true)
  })

  it('fails a file with no attestation, and a check that accepts the previous release’s commit too', async () => {
    const none = await audit(world({ attested: (name, _t, commit) => name !== DMG && commit === COMMIT }))
    const loose = await audit(world({ attested: () => true }))

    expect(none.result.failures.some((line) => line.includes(DMG) && /attestation/.test(line))).toBe(true)
    expect(loose.result.failures.filter((line) => /accepts the previous tag/.test(line))).toHaveLength(3)
  })

  it('does not run the control for the first release, and says so', async () => {
    const w = world({ localTags: [TAG], commits: { [TAG]: COMMIT }, attested: (_n, _t, commit) => commit === COMMIT })

    const { result, log } = await audit(w)

    expect(result.failures).toEqual([])
    expect(log.join('\n')).toMatch(/No earlier release/)
  })

  it('takes the previous release from the tags in the clone, by version, and never a release candidate', async () => {
    const w = world({ localTags: ['v1.0.2', 'v1.1.0-rc.1', TAG, 'v1.0.1'], commits: { [TAG]: COMMIT, 'v1.0.2': PREVIOUS_COMMIT, 'v1.1.0-rc.1': 'c'.repeat(40) } })

    const { result, log } = await audit(w)

    expect(result.failures).toEqual([])
    expect(log.join('\n')).toMatch(/refused with the commit of v1\.0\.2/)
  })

  it('stops with a sentence when the tag is not in the clone', async () => {
    const w = world({ commits: {} })

    await expect(audit(w)).rejects.toThrow(/git fetch --tags/)
  })
})

describe('when a stage cannot run, it does not pass for one that did', () => {
  it('says the .env values were not looked for, instead of "found in 0 of 0 files", when no file was unpacked', async () => {
    const r = await audit(world({ assets: [EXE] }), { envText: `API_KEY=${SECRET}\n` })

    expect(r.log.join('\n')).not.toMatch(/\.env: .*found in/)
    expect(r.notes.join('\n')).toMatch(/\.env values were not looked for.*no file was unpacked/i)
  })

  it('fails when the release cannot be read, skips the files, and still says what changed', async () => {
    const f = fake(world())
    f.host.viewRelease = async () => {
      throw new Error('gh could not read the release v1.1.0')
    }
    const notes: string[] = []

    const result = await releaseAudit({ tag: TAG }, f.host, () => undefined, (line) => notes.push(line))

    expect(result.failures).toEqual(['The release: gh could not read the release v1.1.0'])
    expect(f.calls).toEqual([])
    expect(notes.join('\n')).toMatch(/Changes v1\.0\.2\.\.v1\.1\.0/)
  })

  it('fails when the download fails, and unpacks and mounts nothing', async () => {
    const f = fake(world())
    f.host.download = async () => {
      throw new Error('network is down')
    }

    const result = await releaseAudit({ tag: TAG }, f.host, () => undefined, () => undefined)

    expect(result.failures).toEqual(['The release: network is down'])
    expect(f.calls).toEqual([])
  })

  it.each([
    ['cannot be read', () => Promise.reject(new Error('git could not show the file'))],
    ['has no identifier or minimum system', () => Promise.resolve({})],
  ])('fails once when the tagged config %s, skips what depends on it, and still runs the rest', async (_name, tagConfig) => {
    const w = world()
    const f = fake(w)
    f.host.tagConfig = tagConfig
    let plistReads = 0
    f.host.plist = async () => {
      plistReads++

      return w.plist
    }
    const log: string[] = []

    const result = await releaseAudit({ tag: TAG }, f.host, (line) => log.push(line), () => undefined)

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatch(/^The tagged config:/)
    expect(plistReads).toBe(0)
    expect(log.join('\n')).toMatch(/codesign --verify --deep --strict passes/)
  })

  it.each(['../../../../etc/hosts', 'MacOS/../../x', '..', ''])('does not read a program named %j from the plist: that is not a plain file name', async (program) => {
    const plist = { CFBundleIdentifier: 'com.listulator.desktop', CFBundleShortVersionString: VERSION, LSMinimumSystemVersion: '11.0', CFBundleExecutable: program }

    const { result } = await audit(world({ plist }))

    expect(result.failures).toEqual(['Info.plist: CFBundleExecutable is missing or is not a plain file name'])
  })
})

describe('what is in the Windows installer', () => {
  it('fails a forbidden file, naming it', async () => {
    const { result } = await audit(world({ windows: { ...world().windows, '.env': 'x', 'data/app.sqlite': 'x' } }))

    expect(result.failures.some((line) => /Windows installer/.test(line) && line.includes('.env'))).toBe(true)
    expect(result.failures.some((line) => line.includes('data/app.sqlite'))).toBe(true)
  })

  it('fails a file that holds one of the owner’s .env values, naming the NAME and never the value', async () => {
    const w = world({ windows: { ...world().windows, 'listulator-desktop.exe': Buffer.from(`MZ ${SECRET} tail`) } })

    const r = await audit(w, { envText: `API_KEY=${SECRET}\nPORT=3001\n` })

    expect(r.result.failures.some((line) => line.includes('listulator-desktop.exe') && line.includes('API_KEY'))).toBe(true)
    expect(everything(r)).not.toContain(SECRET)
  })

  it('finds a value stored as UTF-16 text too', async () => {
    const w = world({ windows: { ...world().windows, 'listulator-desktop.exe': Buffer.concat([Buffer.from('MZ'), Buffer.from(SECRET, 'utf16le')]) } })

    const { result } = await audit(w, { envText: `API_KEY=${SECRET}\n` })

    expect(result.failures.some((line) => line.includes('API_KEY'))).toBe(true)
  })

  it('fails a source map reference', async () => {
    const w = world({ windows: { ...world().windows, 'listulator-desktop.exe': Buffer.from('MZ //# sourceMappingURL=index.js.map') } })

    const { result } = await audit(w)

    expect(result.failures.some((line) => /sourceMappingURL/.test(line))).toBe(true)
  })

  it('fails when the installer cannot be unpacked, and still audits the Mac files', async () => {
    const { result, calls } = await audit(world({ unpackFails: true }))

    expect(result.failures.some((line) => /Windows installer/.test(line) && /cannot open/.test(line))).toBe(true)
    expect(calls).toContain('mount')
  })

  it('says it did not look for the .env values when there is no .env, and that is not a failure', async () => {
    const { result, notes } = await audit(world())

    expect(result.failures).toEqual([])
    expect(notes.join('\n')).toMatch(/no \.env/i)
  })
})

describe('what is in the Mac app', () => {
  it('fails when the app in the disk image is not the app in the archive, naming each difference', async () => {
    const w = world({ dmgApp: { ...goodApp(), 'Contents/Resources/icon.icns': 'another icon', 'Contents/Resources/extra.bin': 'x' } })

    const { result } = await audit(w)

    expect(result.failures).toEqual(expect.arrayContaining([expect.stringMatching(/differs: Contents\/Resources\/icon\.icns/), expect.stringMatching(/only in the disk image: Contents\/Resources\/extra\.bin/)]))
  })

  it('names at most ten differences and counts the rest', async () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`Contents/Resources/f${index}.bin`, 'x']))

    const { result } = await audit(world({ dmgApp: { ...goodApp(), ...many } }))

    expect(result.failures.filter((line) => /only in the disk image/.test(line))).toHaveLength(10)
    expect(result.failures.some((line) => /and 15 more/.test(line))).toBe(true)
  })

  it('fails a plist that is not the tagged config’s (the version here)', async () => {
    const { result } = await audit(world({ plist: { CFBundleIdentifier: 'com.listulator.desktop', CFBundleShortVersionString: '1.0.2', LSMinimumSystemVersion: '11.0' } }))

    expect(result.failures.some((line) => /CFBundleShortVersionString/.test(line))).toBe(true)
  })

  it('fails a program that is not arm64 only', async () => {
    const x86 = { ...goodApp(), 'Contents/MacOS/listulator-desktop': machO(0x01000007) }

    const { result } = await audit(world({ tarApp: x86, dmgApp: x86 }))

    expect(result.failures.some((line) => /x86_64/.test(line) && /arm64/.test(line))).toBe(true)
  })

  it('fails a seal that does not verify, for either copy of the app', async () => {
    const dmg = await audit(world({ verifies: (where) => ({ ok: where !== 'dmg', output: 'a sealed resource is missing or invalid' }) }))
    const tar = await audit(world({ verifies: (where) => ({ ok: where !== 'tar', output: 'a sealed resource is missing or invalid' }) }))

    expect(dmg.result.failures.some((line) => /disk image/.test(line) && /sealed resource/.test(line))).toBe(true)
    expect(tar.result.failures.some((line) => /Listulator\.app\.tar\.gz/.test(line) && /sealed resource/.test(line))).toBe(true)
  })

  it('fails entitlements nobody decided on', async () => {
    const { result } = await audit(world({ entitlements: '<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>' }))

    expect(result.failures.some((line) => /entitlements/i.test(line))).toBe(true)
  })

  it('fails a forbidden file in the app, and an .env value in it', async () => {
    const withSecret = { ...goodApp(), 'Contents/Resources/.env': 'x', 'Contents/MacOS/listulator-desktop': Buffer.concat([machO(), Buffer.from(SECRET)]) }

    const r = await audit(world({ tarApp: withSecret, dmgApp: withSecret }), { envText: `API_KEY=${SECRET}\n` })

    expect(r.result.failures.some((line) => line.includes('Contents/Resources/.env'))).toBe(true)
    expect(r.result.failures.some((line) => line.includes('API_KEY'))).toBe(true)
    expect(everything(r)).not.toContain(SECRET)
  })

  it('fails when the disk image cannot be mounted, and still audits the rest', async () => {
    const { result, calls } = await audit(world({ mountFails: true }))

    expect(result.failures.some((line) => /disk image/.test(line) && /attach failed/.test(line))).toBe(true)
    expect(calls).toContain('unpack')
  })
})

describe('the disk image is always let go', () => {
  it('unmounts even when a check throws in the middle', async () => {
    const w = world()
    const f = fake(w)
    f.host.plist = async () => {
      throw new Error('plutil exploded')
    }

    const result = await releaseAudit({ tag: TAG }, f.host, () => undefined, () => undefined)

    expect(result.failures.some((line) => /plutil exploded/.test(line))).toBe(true)
    expect(f.calls).toContain('unmount')
  })

  it('says so, and leaves the folders alone rather than deleting through a mount, when it cannot unmount', async () => {
    const r = await audit(world({ unmountFails: true }))

    expect(r.result.failures.some((line) => /could not unmount/i.test(line) && /resource busy/.test(line))).toBe(true)
    expect(r.mountPoints.every((path) => existsSync(path))).toBe(true)
    expect(r.dirs.every((path) => existsSync(path))).toBe(true)
    expect(r.result.failures.some((line) => /still mounted at/.test(line))).toBe(true)
    for (const path of r.mountPoints) rmSync(path, { recursive: true, force: true })
    for (const path of r.dirs) rmSync(path, { recursive: true, force: true })
  })
})

describe('what changed since the last release', () => {
  it('says how much, by area, as notes (not failures)', async () => {
    const { notes, result } = await audit(world())

    expect(result.failures).toEqual([])
    expect(notes.join('\n')).toMatch(/v1\.0\.2\.\.v1\.1\.0/)
    expect(notes.join('\n')).toMatch(/3 files, \+18 −6/)
    expect(notes.join('\n')).toMatch(/web\/src/)
  })

  it('names the files that see the key or decide the app’s permissions when they changed, as something to read before signing', async () => {
    const { notes } = await audit(world({ names: ['server/src/tools/releaseSign.ts', 'package.json', 'apps/desktop/src-tauri/capabilities/default.json'] }))
    const text = notes.join('\n')

    expect(text).toMatch(/read before.*sign/i)
    expect(text).toMatch(/server\/src\/tools: server\/src\/tools\/releaseSign\.ts/)
    expect(text).toMatch(/apps\/desktop\/src-tauri\/capabilities/)
  })

  it('names a watched FILE once, not twice', async () => {
    const { notes } = await audit(world({ names: ['package.json'] }))

    expect(notes).toContain('  package.json')
    expect(notes.join('\n')).not.toMatch(/package\.json: package\.json/)
  })

  it('shows the biggest areas only, and counts the others', async () => {
    const numstat = Array.from({ length: 12 }, (_, index) => `${index + 1}\t0\tarea${index}/sub/file.ts`).join('\n')

    const { notes } = await audit(world({ numstat }))

    expect(notes.filter((line) => /^ {2}area\d+\/sub:/.test(line))).toHaveLength(8)
    expect(notes.some((line) => /… and 4 more areas/.test(line))).toBe(true)
  })

  it('says when none of them changed', async () => {
    const { notes } = await audit(world({ names: ['web/src/App.tsx'] }))

    expect(notes.join('\n')).toMatch(/unchanged/i)
  })

  it('says there is nothing to compare with for the first release', async () => {
    const w = world({ localTags: [TAG], commits: { [TAG]: COMMIT }, attested: (_n, _t, commit) => commit === COMMIT })

    const { notes } = await audit(w)

    expect(notes.join('\n')).toMatch(/no earlier release/i)
  })
})

describe('the command line', () => {
  it('needs one tag', () => {
    expect(parseReleaseAuditArguments(['v1.1.0'])).toEqual({ tag: 'v1.1.0' })
  })

  it.each([
    ['no tag', []],
    ['two tags', ['v1.1.0', 'v1.0.2']],
    ['an option', ['v1.1.0', '--fix']],
    ['a name that is not a tag', ['main']],
    ['a tag with a path in it', ['v1.1.0/../x']],
  ])('refuses %s, in words', (_name, args) => {
    expect(typeof parseReleaseAuditArguments(args)).toBe('string')
  })
})

describe('the real programs, as they are run (no shell)', () => {
  interface Call {
    command: string
    args: string[]
  }

  function recorder(answer: (call: Call) => { code: number; stdout?: string; stderr?: string } = () => ({ code: 0 })) {
    const calls: Call[] = []
    const runner: Runner = async (command, args) => {
      const call = { command, args }
      calls.push(call)
      const { code, stdout = '', stderr = '' } = answer(call)

      return { code, stdout, stderr }
    }

    return { calls, runner }
  }
  const host = (runner: Runner) => createAuditHost(runner, '/repo')

  it('reads a tag’s commit from the clone, and insists on a full hash', async () => {
    const good = recorder(() => ({ code: 0, stdout: `${COMMIT}\n` }))
    expect(await host(good.runner).tagCommit(TAG)).toBe(COMMIT)
    expect(good.calls[0]).toEqual({ command: 'git', args: ['rev-parse', '--verify', '--quiet', `${TAG}^{commit}`] })

    await expect(host(recorder(() => ({ code: 1 })).runner).tagCommit(TAG)).rejects.toThrow(/git fetch --tags/)
    await expect(host(recorder(() => ({ code: 0, stdout: 'nope' })).runner).tagCommit(TAG)).rejects.toThrow(/git fetch --tags/)
  })

  it('lists the version tags of the clone', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: 'v1.0.0\nv1.1.0\nnightly\n' }))

    expect(await host(runner).localTags()).toEqual(['v1.0.0', 'v1.1.0'])
    expect(calls[0]!.args).toEqual(['tag', '--list', 'v*'])
  })

  it('reads the tagged config from the tag, not from the working tree', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: '{"identifier":"x"}' }))

    expect(await host(runner).tagConfig(TAG)).toEqual({ identifier: 'x' })
    expect(calls[0]!.args).toEqual(['show', `${TAG}:apps/desktop/src-tauri/tauri.conf.json`])
  })

  it('diffs two tags by numbers and by names', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: 'a\tb\tx\n' }))

    await host(runner).diffNumstat(PREVIOUS, TAG)
    await host(runner).diffNames(PREVIOUS, TAG)

    expect(calls[0]!.args).toEqual(['diff', '--numstat', PREVIOUS, TAG, '--'])
    expect(calls[1]!.args).toEqual(['diff', '--name-only', PREVIOUS, TAG, '--'])
  })

  it('unpacks the installer with 7zz into the folder, answering yes to nothing else', async () => {
    const { calls, runner } = recorder()

    await host(runner).unpackInstaller('/tmp/x/Setup.exe', '/tmp/x/win')

    expect(calls[0]).toEqual({ command: '7zz', args: ['x', '-y', '-bd', '-o/tmp/x/win', '/tmp/x/Setup.exe'] })
  })

  it('extracts the archive with tar', async () => {
    const { calls, runner } = recorder()

    await host(runner).extractArchive('/tmp/x/a.tar.gz', '/tmp/x/tar')

    expect(calls[0]).toEqual({ command: 'tar', args: ['-xzf', '/tmp/x/a.tar.gz', '-C', '/tmp/x/tar'] })
  })

  it('mounts the disk image read-only, out of sight, at the mount point, and unmounts it', async () => {
    const { calls, runner } = recorder()

    await host(runner).mountDisk('/tmp/x/a.dmg', '/tmp/mnt')
    await host(runner).unmountDisk('/tmp/mnt')

    expect(calls[0]).toEqual({ command: 'hdiutil', args: ['attach', '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', '/tmp/mnt', '/tmp/x/a.dmg'] })
    expect(calls[1]).toEqual({ command: 'hdiutil', args: ['detach', '/tmp/mnt'] })
  })

  it('forces the unmount once when the first try fails, and fails if that fails too', async () => {
    const stubborn = recorder(() => ({ code: 1, stderr: 'hdiutil: detach failed - resource busy' }))
    await expect(host(stubborn.runner).unmountDisk('/tmp/mnt')).rejects.toThrow(/resource busy/)
    expect(stubborn.calls.map((call) => call.args)).toEqual([['detach', '/tmp/mnt'], ['detach', '-force', '/tmp/mnt']])

    let tries = 0
    const second = recorder(() => ({ code: tries++ === 0 ? 1 : 0 }))
    await host(second.runner).unmountDisk('/tmp/mnt')
    expect(second.calls).toHaveLength(2)
  })

  it('reads the plist as JSON with plutil', async () => {
    const { calls, runner } = recorder(() => ({ code: 0, stdout: '{"CFBundleIdentifier":"x"}' }))

    expect(await host(runner).plist('/tmp/x/Listulator.app')).toEqual({ CFBundleIdentifier: 'x' })
    expect(calls[0]).toEqual({ command: 'plutil', args: ['-convert', 'json', '-o', '-', '/tmp/x/Listulator.app/Contents/Info.plist'] })
  })

  it('verifies the seal with codesign --verify --deep --strict, by exit code', async () => {
    const ok = recorder()
    const bad = recorder(() => ({ code: 1, stderr: 'a sealed resource is missing or invalid' }))

    expect(await host(ok.runner).codesignVerify('/tmp/x/Listulator.app')).toEqual({ ok: true, output: '' })
    expect(ok.calls[0]).toEqual({ command: 'codesign', args: ['--verify', '--deep', '--strict', '/tmp/x/Listulator.app'] })
    expect(await host(bad.runner).codesignVerify('/tmp/x/Listulator.app')).toEqual({ ok: false, output: 'a sealed resource is missing or invalid' })
  })

  it('reads the signature details (codesign prints them on stderr) and the entitlements', async () => {
    const { calls, runner } = recorder((call) => (call.args.includes('--entitlements') ? { code: 0, stdout: '<plist/>' } : { code: 0, stderr: 'Identifier=x' }))

    expect(await host(runner).codesignDetails('/tmp/x/Listulator.app')).toBe('Identifier=x')
    expect(await host(runner).entitlements('/tmp/x/Listulator.app')).toBe('<plist/>')
    expect(calls[0]!.args).toEqual(['-dv', '--verbose=4', '/tmp/x/Listulator.app'])
    expect(calls[1]!.args).toEqual(['-d', '--entitlements', ':-', '/tmp/x/Listulator.app'])
  })
})
