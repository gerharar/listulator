import { loadConfig, loadEnvFile } from '../config.js'
import { createDatabase, runMigrations } from './client.js'

/**
 * Standalone migration entry point (`npm run db:migrate`).
 *
 * The server also migrates on boot, so this exists for the case where you want
 * to apply schema changes without starting anything.
 */
loadEnvFile()

const config = loadConfig()
const { db, close } = createDatabase(config.databasePath)

runMigrations(db)
close()

console.log(`migrations applied to ${config.databasePath}`)
