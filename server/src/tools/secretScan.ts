import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRunDirectly } from './runDirectly.js'

/**
 * Looks for what must never reach this public repository: a private key or a token (Phase 31, task 31.1a, rule S6;
 * docs/DECISIONS.md). GitHub's own secret scanning knows the formats of providers; it does not know a Tauri / minisign updater
 * key, so this does.
 *
 *   npm run secrets:scan                      every file git tracks (the guard test and CI)
 *   git log -p --format= <range> | tsx ... patch   the lines a push would add, from every commit in it (scripts/pre-push)
 *
 * It reports the rule, the file and the line, and never the text it matched: a log is public too.
 */

export interface TextFinding {
  rule: string
  line: number
}

export interface FileFinding extends TextFinding {
  path: string
}

/**
 * The first line of a minisign / Tauri secret key file is a comment that ends in the words "secret key". The PUBLIC key's comment ends
 * in "public key"; a SIGNATURE's comment is "signature from ..." and is published on purpose, so it is not a key. (This comment keeps
 * the words apart on purpose: this file is scanned too.)
 */
const SECRET_KEY_COMMENT = /untrusted comment:(?![^\n]*signature from)[^\n]*secret key/i
/** A run of base64 long enough to hold a key; decoded, it is looked at for the comment above. */
const BASE64_RUN = /[A-Za-z0-9+/]{32,}={0,2}/g
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/
const PROVIDER_TOKENS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b[sr]k_live_[0-9A-Za-z]{24,}/,
]
/** The updater key's variables followed by a value written out (`=`, `:` or PowerShell's ` = `, quoted or not). */
const SIGNING_ASSIGNMENT = /TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?["']?\s*[:=]\s*["']?([^\s"']+)/g
/** A value that points elsewhere (a variable, a secret reference, a path or a placeholder) is not the secret itself. */
const REFERENCE_START = /^[$%<{/~@]/
const MIN_SECRET_VALUE = 16

function signingAssignment(line: string): boolean {
  for (const match of line.matchAll(SIGNING_ASSIGNMENT)) {
    const value = match[1] ?? ''
    if (value.length >= MIN_SECRET_VALUE && !REFERENCE_START.test(value)) return true
  }

  return false
}

/** How many times a key may have been encoded: a key file is base64 already, and pasting it into a CI secret often encodes it again. */
const MAX_ENCODINGS = 3

function base64SecretKey(text: string, depth = 0): boolean {
  if (depth >= MAX_ENCODINGS) return false
  for (const run of text.matchAll(BASE64_RUN)) {
    const decoded = Buffer.from(run[0], 'base64').toString('latin1')
    if (decoded.startsWith('untrusted comment:') ? SECRET_KEY_COMMENT.test(decoded) : base64SecretKey(decoded, depth + 1)) return true
  }

  return false
}

/** The first rule a single line breaks, if any. */
function ruleOfLine(line: string): string | undefined {
  if (SECRET_KEY_COMMENT.test(line) || base64SecretKey(line)) return 'tauri-secret-key'
  if (PRIVATE_KEY_BLOCK.test(line)) return 'private-key-block'
  if (PROVIDER_TOKENS.some((pattern) => pattern.test(line))) return 'provider-token'
  if (signingAssignment(line)) return 'signing-key-assignment'

  return undefined
}

/** Every line of `text` that breaks a rule, with its 1-based number; never the text itself. */
export function scanText(text: string): TextFinding[] {
  const found: TextFinding[] = []
  text.split('\n').forEach((line, index) => {
    const rule = ruleOfLine(line)
    if (rule !== undefined) found.push({ rule, line: index + 1 })
  })

  return found
}

const KEY_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx'])
const KEY_BASENAMES = /^id_(?:rsa|dsa|ecdsa|ed25519)$/

/** A name a private key is usually saved under. The public half (`*.pub`) is not one: it is meant to be committed. */
export function forbiddenFileName(path: string): string | undefined {
  const name = basename(path.replace(/\\/g, '/'))
  if (name.endsWith('.pub')) return undefined
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : ''
  if (KEY_EXTENSIONS.has(extension) || KEY_BASENAMES.test(name) || name.startsWith('.listulator-updater')) return 'key-file-name'

  return undefined
}

/** The lines a patch (`git log -p`, `git diff`) ADDS, and the names of the files it adds or changes. Removed and context lines are not looked at. */
export function scanPatch(patch: string): FileFinding[] {
  const found: FileFinding[] = []
  let path: string | undefined
  let next = 0
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      path = undefined
      inHunk = false
    } else if (!inHunk && line.startsWith('+++ ')) {
      const target = line.slice(4)
      path = target === '/dev/null' ? undefined : target.replace(/^b\//, '')
      if (path !== undefined && forbiddenFileName(path) !== undefined) found.push({ path, rule: 'key-file-name', line: 0 })
    } else if (line.startsWith('@@')) {
      const start = /\+(\d+)/.exec(line)
      next = start ? Number(start[1]) : 0
      inHunk = true
    } else if (inHunk && path !== undefined) {
      if (line.startsWith('+')) {
        const rule = ruleOfLine(line.slice(1))
        if (rule !== undefined) found.push({ path, rule, line: next })
        next += 1
      } else if (line.startsWith(' ')) {
        next += 1
      }
    }
  }

  return found
}

const MAX_SCANNED_BYTES = 20 * 1024 * 1024

function looksBinary(file: string): boolean {
  const descriptor = openSync(file, 'r')
  try {
    const head = Buffer.alloc(8000)
    const read = readSync(descriptor, head, 0, head.length, 0)

    return head.subarray(0, read).includes(0)
  } finally {
    closeSync(descriptor)
  }
}

/** Scans the named files (paths relative to `root`): their names, and their text unless they are binary. */
export function scanFiles(root: string, paths: string[]): FileFinding[] {
  const found: FileFinding[] = []
  for (const path of paths) {
    if (forbiddenFileName(path) !== undefined) found.push({ path, rule: 'key-file-name', line: 0 })
    const file = join(root, path)
    let size: number
    try {
      size = statSync(file).size
    } catch {
      continue // listed by git but not on disk (deleted, not yet staged)
    }
    if (size > MAX_SCANNED_BYTES || looksBinary(file)) continue
    for (const finding of scanText(readFileSync(file, 'utf8'))) found.push({ path, ...finding })
  }

  return found
}

/** The files git tracks in `root`, and the new ones it has not tracked yet (not the ignored ones): what a commit could contain. */
export function trackedFiles(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '')
}

export function describeFindings(findings: FileFinding[]): string {
  return findings.map((finding) => `${finding.path}${finding.line > 0 ? `:${finding.line}` : ''}  ${finding.rule}`).join('\n')
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

if (isRunDirectly(import.meta.url)) {
  const mode = process.argv[2] ?? 'tree'
  const findings = mode === 'patch' ? scanPatch(readFileSync(0, 'utf8')) : scanFiles(REPO_ROOT, trackedFiles(REPO_ROOT))
  if (findings.length > 0) {
    console.error(`A key or secret may be in ${mode === 'patch' ? 'what you are about to push' : 'a tracked file'} (the text is not printed):\n${describeFindings(findings)}`)
    process.exit(1)
  }
  console.log(mode === 'patch' ? 'No key or secret in the pushed lines.' : 'No key or secret in the tracked files.')
}
