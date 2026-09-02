import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createDatabase, runMigrations } from './db/client.js'

const config = loadConfig()
const { db } = createDatabase(config.databasePath)

// Idempotent, and keeps the self-host story to "start it and go".
runMigrations(db)

const app = buildApp({ db, config })

try {
  await app.listen({ port: config.port, host: config.host })
  console.log(`server listening on http://${config.host}:${config.port}`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
