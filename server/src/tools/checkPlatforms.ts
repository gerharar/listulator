import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePlatformsCsv, type PlatformRow } from './generatePlatforms.js'
import { isRunDirectly } from './runDirectly.js'

/**
 * Compares IGDB's live platform list with `config/platforms.csv` (10.24c). A
 * game on a platform the file lacks is imported untagged there, so run this now
 * and then — `npm run platforms:check -w server` (needs IGDB_CLIENT_ID and
 * IGDB_CLIENT_SECRET in `.env`) — and add what it reports. It changes nothing.
 */

const CSV_PATH = fileURLToPath(new URL('../../../config/platforms.csv', import.meta.url))

export function comparePlatforms(
  igdb: readonly { id: number; name: string }[],
  rows: readonly PlatformRow[],
): { missing: string[]; gone: string[] } {
  const listed = new Set(rows.map((row) => row.igdbId))
  const live = new Set(igdb.map((platform) => platform.id))

  return {
    missing: igdb.filter((platform) => !listed.has(platform.id)).map((platform) => `${platform.id};${platform.name};`),
    gone: rows.filter((row) => !live.has(row.igdbId)).map((row) => `${row.igdbId};${row.name};${row.code}`),
  }
}

async function fetchIgdbPlatforms(): Promise<{ id: number; name: string }[]> {
  const clientId = process.env['IGDB_CLIENT_ID']
  const clientSecret = process.env['IGDB_CLIENT_SECRET']
  if (!clientId || !clientSecret) throw new Error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set in .env')

  const token = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}` +
      `&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
    { method: 'POST' },
  ).then((response) => response.json() as Promise<{ access_token?: string }>)
  if (!token.access_token) throw new Error('IGDB refused the credentials in .env')

  const platforms: { id: number; name: string }[] = []
  for (let offset = 0; ; offset += 500) {
    const page = await fetch('https://api.igdb.com/v4/platforms', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token.access_token}` },
      body: `fields id,name; limit 500; offset ${offset}; sort id asc;`,
    }).then((response) => response.json() as Promise<{ id: number; name: string }[]>)
    platforms.push(...page)
    if (page.length < 500) return platforms
  }
}

if (isRunDirectly(import.meta.url)) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
  } catch {
    // No .env: the credentials may come from the environment itself.
  }
  const { missing, gone } = comparePlatforms(await fetchIgdbPlatforms(), parsePlatformsCsv(readFileSync(CSV_PATH, 'utf8')))

  if (missing.length === 0 && gone.length === 0) {
    console.log('config/platforms.csv lists every IGDB platform.')
  } else {
    if (missing.length) {
      console.log(`IGDB platforms missing from config/platforms.csv (games on them import untagged). Add a code, then run npm run platforms:generate -w server:\n${missing.join('\n')}`)
    }
    if (gone.length) console.log(`\nRows whose platform IGDB no longer lists:\n${gone.join('\n')}`)
    process.exitCode = 1
  }
}
