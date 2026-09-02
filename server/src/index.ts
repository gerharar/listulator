import { buildApp } from './app.js'

const PORT = Number(process.env['PORT'] ?? 3001)
const HOST = process.env['HOST'] ?? '127.0.0.1'

const app = buildApp()

try {
  await app.listen({ port: PORT, host: HOST })
  console.log(`server listening on http://${HOST}:${PORT}`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
