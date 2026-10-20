// SPIKE (Phase 31, task 31.2), throwaway: drive the app through tauri-driver (W3C WebDriver on :4444) with plain fetch.
const base = 'http://127.0.0.1:4444'
const application = process.env.SPIKE_APP
const call = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, body: text.slice(0, 600) }
}
const out = { created: null, title: null, text: null, error: null }
try {
  const created = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'wry', 'tauri:options': { application } } } })
  out.created = created
  const id = JSON.parse(created.body).value?.sessionId
  if (!id) throw new Error('no session id')
  await new Promise((resolve) => setTimeout(resolve, 5000))
  out.title = (await call('GET', `/session/${id}/title`)).body
  out.text = (await call('POST', `/session/${id}/execute/sync`, { script: 'return document.body.innerText.slice(0, 300)', args: [] })).body
  await call('DELETE', `/session/${id}`)
} catch (error) {
  out.error = String(error)
}
console.log(JSON.stringify(out))
process.exit(out.error === null && out.text !== null ? 0 : 1)
