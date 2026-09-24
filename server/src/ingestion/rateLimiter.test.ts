import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rateLimiter.js'

/** A fake clock: `sleep` advances time instead of waiting, and records how long it was asked to. */
function fakeClock() {
  let time = 0
  const sleeps: number[] = []

  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      time += ms
    },
    advance: (ms: number) => {
      time += ms
    },
    sleeps,
  }
}

describe('createRateLimiter', () => {
  it('lets the first call through immediately', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter(1000, clock)

    await limiter.run(async () => 'a')

    expect(clock.sleeps).toEqual([])
  })

  it('spaces starts at least the interval apart, however many are queued at once', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter(1000, clock)
    const startedAt: number[] = []

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        limiter.run(async () => {
          startedAt.push(clock.now())
          return n
        }),
      ),
    )

    expect(startedAt).toEqual([0, 1000, 2000, 3000])
  })

  it('does not wait again when enough time has passed on its own', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter(1000, clock)

    await limiter.run(async () => 1)
    clock.advance(5000)
    await limiter.run(async () => 2)

    expect(clock.sleeps).toEqual([])
  })

  it('runs in the order calls were made (first come, first served)', async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter(1000, clock)
    const order: string[] = []

    await Promise.all(
      ['first', 'second', 'third'].map((name) => limiter.run(async () => void order.push(name))),
    )

    expect(order).toEqual(['first', 'second', 'third'])
  })

  it("passes a call's result through and its failure too, without stalling the queue", async () => {
    const clock = fakeClock()
    const limiter = createRateLimiter(1000, clock)

    const failing = limiter.run(async () => {
      throw new Error('upstream down')
    })
    const following = limiter.run(async () => 'still ran')

    await expect(failing).rejects.toThrow('upstream down')
    await expect(following).resolves.toBe('still ran')
  })
})
