import { expect, test } from '@playwright/test'
import { SEED, SEED_YAML } from './states.js'

/** Makes the lists every state reads, once, on the throw-away database. The same text every run, so the same screens. */
test('the throw-away database holds the identity lists', async ({ request }) => {
  await expect.poll(async () => (await request.get('/api/lists')).ok(), { timeout: 30_000 }).toBe(true)
  for (const key of Object.keys(SEED) as (keyof typeof SEED)[]) {
    const made = await request.post('/api/lists/from-file', { data: { yaml: SEED_YAML[key] } })
    expect(made.status(), `making ${SEED[key]}`).toBe(201)
  }
  // A few items done, so the rows show more than one state.
  const lists = (await (await request.get('/api/lists')).json()) as { id: string; title: string }[]
  const saga = lists.find((list) => list.title === SEED.saga)!
  const detail = (await (await request.get(`/api/lists/${saga.id}`)).json()) as { items: { id: string; title: string }[] }
  for (const title of ['Saga One', 'Saga Two', 'Saga Five']) {
    const item = detail.items.find((candidate) => candidate.title === title)!
    expect((await request.put(`/api/lists/${saga.id}/items/${item.id}/consumed`, { data: { consumed: true } })).ok()).toBe(true)
  }
})
