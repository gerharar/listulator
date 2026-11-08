import { rmSync } from 'node:fs'
import { test } from '@playwright/test'

/** Runs after every capture: the throw-away database goes with it. */
test('the throw-away database is removed', () => {
  const dir = process.env['IDENTITY_DB_DIR']
  if (dir !== undefined && dir.includes('listulator-identity-')) rmSync(dir, { recursive: true, force: true })
})
