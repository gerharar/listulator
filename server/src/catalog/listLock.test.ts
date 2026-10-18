import { describe, expect, it } from 'vitest'
import { withListLock } from './listLock.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('withListLock (BL-103)', () => {
  it('runs overlapping work on one list one after the other, in the order it was asked', async () => {
    const log: string[] = []
    const job = (name: string) => async () => {
      log.push(`${name} start`)
      await tick()
      log.push(`${name} end`)
      return name
    }

    const results = await Promise.all([
      withListLock('list-1', job('a')),
      withListLock('list-1', job('b')),
      withListLock('list-1', job('c')),
    ])

    expect(results).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end'])
  })

  it('does not hold up another list', async () => {
    const log: string[] = []
    const slow = withListLock('list-1', async () => {
      await tick()
      await tick()
      log.push('slow end')
    })
    const other = withListLock('list-2', async () => {
      log.push('other end')
    })

    await Promise.all([slow, other])

    expect(log).toEqual(['other end', 'slow end'])
  })

  it('lets the next one run after one fails, and hands the failure to its own caller only', async () => {
    const failing = withListLock('list-1', async () => {
      throw new Error('boom')
    })
    const next = withListLock('list-1', async () => 'ran')

    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ran')
  })

  it('forgets a list once its work is done, so the map does not grow', async () => {
    await withListLock('list-1', async () => undefined)
    await tick()

    const { lockedListCount } = await import('./listLock.js')
    expect(lockedListCount()).toBe(0)
  })
})
