import { buildApp } from './app.js'
import { maintainSourceCopies, startSourceCopySchedule } from './catalog/sourceCopySchedule.js'
import { loadConfig, loadEnvFile } from './config.js'
import { createDatabase, runMigrations } from './db/client.js'
import { createMediaTypeRegistry } from './ingestion/mediaTypes.js'

// Before anything reads process.env.
loadEnvFile()

const config = loadConfig()
const { db } = createDatabase(config.databasePath)

// Idempotent, and keeps the self-host story to "start it and go".
runMigrations(db)

// The same registry serves requests and the daily source-copy check below.
const mediaTypes = createMediaTypeRegistry()
const app = buildApp({ db, config, mediaTypes })

let stopSourceCopyCheck: (() => void) | undefined
app.addHook('onClose', async () => stopSourceCopyCheck?.())

try {
  await app.listen({ port: config.port, host: config.host })
  console.log(`server listening on http://${config.host}:${config.port}`)

  // A fetched list's stored copy must be refreshed or dropped within its source's limit
  // (docs/DECISIONS.md, Phase 12): checked now and then every day.
  stopSourceCopyCheck = startSourceCopySchedule(
    async () => {
      const summary = await maintainSourceCopies(db, { mediaTypes: mediaTypes.list() })
      if (summary.checked > 0) console.log('source copies checked:', JSON.stringify(summary))
    },
    { onError: (error) => console.error('source copy check failed:', error) },
  )
} catch (error) {
  console.error(error)
  process.exit(1)
}
