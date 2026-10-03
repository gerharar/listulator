import { describe, expect, it } from 'vitest'
import { createPacer, createRateLimiter } from './rateLimiter.js'

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

describe('createPacer: spaces the starts of requests and lets them overlap (15.9)', () => {
  function clock() {
    let now = 0
    const sleeps: number[] = []

    // A sleep that ends at a time of its own, as real ones do side by side: the clock only moves forward.
    const sleep = (ms: number) => {
      const until = now + ms
      sleeps.push(ms)

      return Promise.resolve().then(() => void (now = Math.max(now, until)))
    }

    return { sleeps, now: () => now, set: (to: number) => void (now = to), sleep }
  }

  it('starts the first at once and gives each later one its own slot, whatever arrives together', async () => {
    const fake = clock()
    const pacer = createPacer(25, fake)
    let ran = 0

    await Promise.all([1, 2, 3, 4].map(() => pacer.run(async () => void (ran += 1))))

    // The first waits for nothing; the next three wait for slots 25, 50 and 75 ms on.
    expect(fake.sleeps).toEqual([25, 50, 75])
    expect(ran).toBe(4)
  })

  it('does not wait for a request to finish before starting the next: they run side by side', async () => {
    const pacer = createPacer(0)
    let inFlight = 0
    let peak = 0

    await Promise.all(
      Array.from({ length: 6 }, () =>
        pacer.run(async () => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 5))
          inFlight -= 1
        }),
      ),
    )

    expect(peak).toBe(6)
  })

  it('does not hold anyone back once the line is quiet again', async () => {
    const fake = clock()
    const pacer = createPacer(25, fake)

    await pacer.run(async () => undefined)
    fake.set(1000)

    await pacer.run(async () => undefined)

    expect(fake.sleeps).toEqual([])
  })

  it('passes the result, and the failure, of the request through; a failure does not hold up the others', async () => {
    const pacer = createPacer(0)

    await expect(pacer.run(async () => 7)).resolves.toBe(7)
    await expect(pacer.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(pacer.run(async () => 8)).resolves.toBe(8)
  })
})

