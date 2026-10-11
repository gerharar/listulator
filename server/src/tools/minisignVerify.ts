import { createHash, createPublicKey, verify } from 'node:crypto'

/**
 * Verifies a minisign signature (the format `tauri signer sign` writes) against a public key, the way the updater plugin does
 * (Phase 20, task 20.12c). The signing script uses it to re-check, before it uploads anything, that every signature it made
 * verifies against the public key built into the app: a file signed with a different key, or a signature that was damaged on
 * the way, is caught on the owner's machine instead of by every user's app.
 *
 * The format: a signature file has four lines: an untrusted comment; the signature (`Ed` or `ED`, the key's ID, 64 bytes);
 * a trusted comment; and a second signature over the first signature plus the trusted comment, which is what makes the comment
 * (the file name and the version) trustworthy. `ED` signs the BLAKE2b-512 hash of the data, `Ed` the data itself. Both are accepted,
 * as the plugin accepts them. Keys and signatures arrive as the app and the manifest carry them: the base64 of the whole file.
 */

export type VerifyResult = { ok: true; keyId: string; trustedComment: string } | { ok: false; reason: string }

/** DER prefix of an Ed25519 public key (RFC 8410); the 32 key bytes follow. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

const fail = (reason: string): VerifyResult => ({ ok: false, reason })

/** Standard base64 with canonical padding and no whitespace: undefined for anything else. */
function strictBase64(text: string): Buffer | undefined {
  if (text === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return undefined
  const bytes = Buffer.from(text, 'base64')

  return bytes.toString('base64') === text ? bytes : undefined
}

const keyIdOf = (bytes: Buffer): string => Buffer.from(bytes).reverse().toString('hex').toUpperCase()

function ed25519(key: Buffer, message: Buffer, signature: Buffer): boolean {
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, key]), format: 'der', type: 'spki' })

    return verify(null, message, publicKey, signature)
  } catch {
    return false
  }
}

/** `pubkey`: the base64 of the `.pub` file (as in `plugins.updater.pubkey`); `signature`: the content of the `.sig` file. */
export function verifyMinisign(pubkey: string, signature: string, data: Uint8Array): VerifyResult {
  const keyFile = strictBase64(pubkey)
  if (keyFile === undefined) return fail('the public key is not base64')
  const keyLine = strictBase64(keyFile.toString('utf8').split('\n')[1] ?? '')
  if (keyLine === undefined || keyLine.length !== 42 || keyLine.subarray(0, 2).toString('latin1') !== 'Ed') return fail('the public key is not a minisign public key')
  const keyId = keyIdOf(keyLine.subarray(2, 10))
  const key = keyLine.subarray(10)

  const signatureFile = strictBase64(signature)
  if (signatureFile === undefined) return fail('the signature is not base64')
  const lines = signatureFile.toString('utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length !== 4) return fail('the signature does not have four lines')
  const [, signatureLine, trustedLine, globalLine] = lines as [string, string, string, string]

  const signed = strictBase64(signatureLine)
  if (signed === undefined || signed.length !== 74) return fail('the signature line is not 74 bytes')
  const algorithm = signed.subarray(0, 2).toString('latin1')
  if (algorithm !== 'ED' && algorithm !== 'Ed') return fail('the signature is not a minisign signature')
  if (!trustedLine.startsWith('trusted comment: ')) return fail('the signature has no trusted comment')
  const globalSignature = strictBase64(globalLine)
  if (globalSignature === undefined || globalSignature.length !== 64) return fail('the global signature is not 64 bytes')

  const signatureKeyId = keyIdOf(signed.subarray(2, 10))
  if (signatureKeyId !== keyId) return fail(`the signature was made with key ${signatureKeyId}, not key ${keyId}`)

  const body = Buffer.from(data)
  const message = algorithm === 'ED' ? createHash('blake2b512').update(body).digest() : body
  const fileSignature = signed.subarray(10)
  if (!ed25519(key, message, fileSignature)) return fail('the signature does not match the file (changed, damaged or signed by another key)')

  const trustedComment = trustedLine.slice('trusted comment: '.length)
  if (!ed25519(key, Buffer.concat([fileSignature, Buffer.from(trustedComment)]), globalSignature)) {
    return fail('the trusted comment does not match its signature (it was changed)')
  }

  return { ok: true, keyId, trustedComment }
}
