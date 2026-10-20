import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { forbiddenFileName, scanPatch, scanText, trackedFiles } from './secretScan.js'

/**
 * The fixtures are built from pieces at run time: this file must hold nothing that looks like a key, a token or a secret, or the scan
 * that guards the repository would flag its own test (and a provider's secret scanning might refuse the push).
 */
const SECRET_KEY_COMMENT = ['untrusted', 'comment:', 'rsign encrypted', 'secret key'].join(' ')
const PUBLIC_KEY_COMMENT = ['untrusted comment:', 'minisign public', 'key: 0123456789ABCDEF'].join(' ')
const KEY_BODY = ['RWRT', 'Y0Iy', 'a'.repeat(40), 'B'.repeat(40)].join('')
const base64 = (text: string): string => Buffer.from(text).toString('base64')

const secretKeyFile = `${SECRET_KEY_COMMENT}\n${KEY_BODY}\n`
const secretKeyBase64 = base64(secretKeyFile)
const publicKeyBase64 = base64(`${PUBLIC_KEY_COMMENT}\n${KEY_BODY}\n`)

const rulesOf = (text: string): string[] => scanText(text).map((finding) => finding.rule)

describe('scanText', () => {
  describe('a Tauri / minisign secret key', () => {
    it('is found in its file form, on the line of the comment', () => {
      expect(scanText(`one\ntwo\n${secretKeyFile}`)).toEqual([{ rule: 'tauri-secret-key', line: 3 }])
    })

    it('is found in the base64 form the TAURI_SIGNING_PRIVATE_KEY variable takes, whatever surrounds it', () => {
      expect(rulesOf(secretKeyBase64)).toEqual(['tauri-secret-key'])
      expect(rulesOf(`{"key": "${secretKeyBase64}"}`)).toEqual(['tauri-secret-key'])
      expect(rulesOf(`export SOMETHING="${secretKeyBase64}"`)).toEqual(['tauri-secret-key'])
    })

    it('is found when it was encoded once more (a key file is already base64; pasting it into a CI secret often encodes it again)', () => {
      expect(rulesOf(secretKeyBase64)).toEqual(['tauri-secret-key'])
      expect(rulesOf(base64(secretKeyBase64))).toEqual(['tauri-secret-key'])
      expect(rulesOf(`TOKEN="${base64(base64(secretKeyBase64))}"`)).toEqual(['tauri-secret-key'])
    })

    it('is found when the base64 is wrapped over several lines, at any width (the base64 command wraps at 76, other tools at 64, 60 or less)', () => {
      for (const width of [76, 64, 60, 40, 32, 20]) {
        const wrapped = secretKeyBase64.match(new RegExp(`.{1,${width}}`, 'g'))!.join('\n')

        expect(scanText(`header\n${wrapped}\nfooter`), `width ${width}`).toEqual([{ rule: 'tauri-secret-key', line: 2 }])
      }
    })

    it('does not take wrapped base64 of the PUBLIC key, or of ordinary data, for a key', () => {
      expect(scanText(publicKeyBase64.match(/.{1,40}/g)!.join('\n'))).toEqual([])
      expect(scanText(Buffer.from('just some ordinary words, long enough to wrap onto several lines of base64').toString('base64').match(/.{1,20}/g)!.join('\n'))).toEqual([])
    })

    it('is not confused with the PUBLIC key, which is the same shape and is committed on purpose (tauri.conf.json)', () => {
      expect(scanText(`${PUBLIC_KEY_COMMENT}\n${KEY_BODY}\n`)).toEqual([])
      expect(scanText(`"pubkey": "${publicKeyBase64}"`)).toEqual([])
    })

    it('is not confused with a SIGNATURE, whose comment also names a secret key and which is published on purpose (the .sig files, the tests)', () => {
      const comment = ['untrusted comment:', 'signature from tauri', 'secret key'].join(' ')
      const signature = `${comment}\n${KEY_BODY}\ntrusted comment: timestamp:1 file:x version:1.0.0\n${KEY_BODY}\n`

      expect(scanText(signature)).toEqual([])
      expect(scanText(base64(signature))).toEqual([])
    })

    it('is found for the other comments a key file can carry', () => {
      expect(rulesOf(['untrusted', 'comment:', 'minisign encrypted', 'secret key'].join(' '))).toEqual(['tauri-secret-key'])
      expect(rulesOf(['untrusted', 'comment:', 'minisign', 'secret key'].join(' '))).toEqual(['tauri-secret-key'])
    })

    it('is not found in a sentence that merely talks about it', () => {
      expect(scanText('The updater key is a secret key kept offline; the untrusted comment line names it.')).toEqual([])
    })
  })

  describe('a PEM private key', () => {
    it('is found by its header, whatever the algorithm', () => {
      for (const kind of ['', 'RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED ']) {
        expect(rulesOf(`-----BEGIN ${kind}PRIVATE KEY-----\nMIIB\n`)).toEqual(['private-key-block'])
      }
    })

    it('is not found for a public key or a certificate', () => {
      expect(scanText('-----BEGIN PUBLIC KEY-----\nMIIB\n-----BEGIN CERTIFICATE-----\n')).toEqual([])
    })
  })

  describe('a token of a provider', () => {
    it('is found for GitHub, Google, Slack, AWS and Stripe shapes', () => {
      const tokens = [
        ['gh', 'p_', 'x'.repeat(36)].join(''),
        ['github', '_pat_', 'x'.repeat(60)].join(''),
        ['AI', 'za', 'x'.repeat(35)].join(''),
        ['xo', 'xb-', '1'.repeat(12), '-', 'a'.repeat(24)].join(''),
        ['AK', 'IA', 'A'.repeat(16)].join(''),
        ['sk', '_live_', 'x'.repeat(24)].join(''),
      ]
      for (const token of tokens) expect(rulesOf(`value = ${token}`)).toEqual(['provider-token'])
    })

    it('is not found in ordinary words or short strings', () => {
      expect(scanText('a ghost_writer and a skeleton_key and a task_live_view')).toEqual([])
    })
  })

  describe('the updater key variables with a value', () => {
    const named = ['TAURI_SIGNING', 'PRIVATE_KEY'].join('_')
    const password = `${named}_PASSWORD`
    const longValue = 'q'.repeat(24)

    it('are found when the value is written out, in any of the usual notations', () => {
      expect(rulesOf(`${named}=${longValue}`)).toEqual(['signing-key-assignment'])
      expect(rulesOf(`  ${named}: ${longValue}`)).toEqual(['signing-key-assignment'])
      expect(rulesOf(`$env:${password} = "${longValue}"`)).toEqual(['signing-key-assignment'])
      expect(rulesOf(`export ${password}='${longValue}'`)).toEqual(['signing-key-assignment'])
    })

    it('are not found when the line refers to a value kept elsewhere, or names none', () => {
      expect(scanText(`${named}: \${{ secrets.SOMETHING }}`)).toEqual([])
      expect(scanText(`$env:${named} = $env:OTHER_VARIABLE_NAME_HERE`)).toEqual([])
      expect(scanText(`${password}=$PASSPHRASE_FROM_THE_PROMPT_XYZ`)).toEqual([])
      expect(scanText(`${named}=`)).toEqual([])
      expect(scanText(`${named}: x`)).toEqual([])
      expect(scanText(`a hostile workflow sets ${named} to a value`)).toEqual([])
      expect(scanText(`${named}=/PATH/TO/updater-key-file-name-here`)).toEqual([])
    })
  })

  it('reports the line and the rule and never the text it matched', () => {
    const found = scanText(`fine\n${secretKeyBase64}\n`)

    expect(found).toEqual([{ rule: 'tauri-secret-key', line: 2 }])
    expect(JSON.stringify(found)).not.toContain(secretKeyBase64.slice(0, 20))
  })

  it('reports every offending line, in order', () => {
    expect(scanText(`${secretKeyFile}\n-----BEGIN ${'RSA '}PRIVATE KEY-----`)).toEqual([
      { rule: 'tauri-secret-key', line: 1 },
      { rule: 'private-key-block', line: 4 },
    ])
  })

  it('finds nothing in an empty text or in plain prose', () => {
    expect(scanText('')).toEqual([])
    expect(scanText('Nothing to see here.\nJust two lines.\n')).toEqual([])
  })
})

describe('forbiddenFileName', () => {
  it('refuses the names a private key is usually saved under', () => {
    for (const path of ['updater.key', 'a/b/new-updater.key', '.listulator-updater.key', 'server.pem', 'x/cert.p12', 'x/cert.pfx', 'id_rsa', 'home/.ssh/id_ed25519']) {
      expect(forbiddenFileName(path), path).toBe('key-file-name')
    }
  })

  it('lets through the PUBLIC half and ordinary files', () => {
    for (const path of ['updater.key.pub', 'server/src/tools/secretScan.ts', 'apps/desktop/src-tauri/tauri.conf.json', 'keyboard.ts', 'monkey.test.ts', 'lists/key-largo.yaml']) {
      expect(forbiddenFileName(path), path).toBeUndefined()
    }
  })
})

describe('scanPatch', () => {
  const patch = (...lines: string[]): string => lines.join('\n')

  it('looks at the lines a commit ADDS, with the file and the line number in the new file', () => {
    const found = scanPatch(
      patch('diff --git a/x/notes.txt b/x/notes.txt', '--- a/x/notes.txt', '+++ b/x/notes.txt', '@@ -3,2 +10,3 @@', ' context', `+${secretKeyBase64}`, ' more'),
    )

    expect(found).toEqual([{ path: 'x/notes.txt', rule: 'tauri-secret-key', line: 11 }])
  })

  it('does not flag a line the commit removes, nor a context line', () => {
    expect(scanPatch(patch('diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,2 +1,1 @@', `-${secretKeyBase64}`, ` ${secretKeyBase64}`))).toEqual([])
  })

  it('flags a file added under a forbidden name even when its content looks harmless', () => {
    const found = scanPatch(patch('diff --git a/new.key b/new.key', 'new file mode 100644', '--- /dev/null', '+++ b/new.key', '@@ -0,0 +1 @@', '+hello'))

    expect(found).toEqual([{ path: 'new.key', rule: 'key-file-name', line: 0 }])
  })

  it('walks several files and reports each in its own name', () => {
    const found = scanPatch(
      patch(
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -0,0 +1 @@',
        `+${secretKeyBase64}`,
        'diff --git a/b.txt b/b.txt',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -0,0 +1,3 @@',
        '+a',
        '+b',
        `+-----BEGIN ${'EC '}PRIVATE KEY-----`,
      ),
    )

    expect(found).toEqual([
      { path: 'a.txt', rule: 'tauri-secret-key', line: 1 },
      { path: 'b.txt', rule: 'private-key-block', line: 3 },
    ])
  })

  it('finds nothing in an empty patch', () => {
    expect(scanPatch('')).toEqual([])
  })
})

describe('trackedFiles', () => {
  it('lists the files git tracks AND the new ones it has not tracked yet, but not the ignored ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'tracked-'))
    try {
      execFileSync('git', ['init', '-q', root])
      writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
      writeFileSync(join(root, 'tracked.txt'), 'a')
      execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root })
      mkdirSync(join(root, 'sub'))
      writeFileSync(join(root, 'sub', 'new-and-untracked.txt'), 'b')
      writeFileSync(join(root, 'ignored.txt'), 'c')

      expect(trackedFiles(root).sort()).toEqual(['.gitignore', 'sub/new-and-untracked.txt', 'tracked.txt'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
