import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'

/**
 * Makes minisign keys and signatures with Node's own Ed25519, for tests of the code that reads and checks them
 * (`minisignVerify.ts`, `releaseSign.ts`): a second key to sign with, a signature of a chosen file and trusted comment, in
 * the form the Tauri CLI writes. Tests only: nothing here is used by the app or by a release.
 */

export interface TestKeyPair {
  privateKey: KeyObject
  /** The 8 bytes the signatures carry (little-endian), and the 16 hex digits they print as. */
  keyIdBytes: Buffer
  keyId: string
  /** The public key as `plugins.updater.pubkey` writes it: the base64 of the two-line `.pub` file. */
  pubkey: string
}

const encode = (value: string) => Buffer.from(value).toString('base64')

/** A new Ed25519 key pair with the given key ID (hex digits, in the order they are printed). */
export function makeKeyPair(keyId = '0123456789ABCDEF'): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const keyIdBytes = Buffer.from(keyId, 'hex').reverse()
  const pubFile = `untrusted comment: minisign public key: ${keyId.toUpperCase()}\n${Buffer.concat([Buffer.from('Ed'), keyIdBytes, raw]).toString('base64')}\n`

  return { privateKey, keyIdBytes, keyId: keyId.toUpperCase(), pubkey: encode(pubFile) }
}

/**
 * The content of a `.sig` file for `data`: prehashed (`ED`, over BLAKE2b-512 of the data, what Tauri writes) or legacy (`Ed`, over the
 * data itself), with the trusted comment signed as well. `keyIdBytes` may differ from the key's own, to make a forgery.
 */
export function signLikeTauri(
  privateKey: KeyObject,
  keyIdBytes: Buffer,
  data: Uint8Array,
  trustedComment: string,
  algorithm: 'ED' | 'Ed' = 'ED',
): string {
  const body = Buffer.from(data)
  const message = algorithm === 'ED' ? createHash('blake2b512').update(body).digest() : body
  const signature = sign(null, message, privateKey)
  const global = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), privateKey)

  return encode(
    `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from(algorithm), keyIdBytes, signature]).toString('base64')}\ntrusted comment: ${trustedComment}\n${global.toString('base64')}\n`,
  )
}
