// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_VERSION } from './appVersion.js'
import { appUpdateChecker, devChecker, unavailableChecker } from './appUpdate.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  window.history.replaceState({}, '', '/')
})

describe('the shipped checker', () => {
  it('has nothing to check against yet: it says so, claims nothing, and cannot download', async () => {
    await expect(unavailableChecker.check()).resolves.toEqual({ kind: 'unavailable' })
    expect(unavailableChecker.download).toBeUndefined()
  })
})

describe('the dev-only checker (?aboutUpdate=…)', () => {
  it('is not there without the parameter, or with a value it does not know', () => {
    expect(devChecker('')).toBeUndefined()
    expect(devChecker('?other=1')).toBeUndefined()
    expect(devChecker('?aboutUpdate=nonsense')).toBeUndefined()
  })

  it('latest: answers up to date after a moment, so Checking… can be seen', async () => {
    const checker = devChecker('?aboutUpdate=latest')!
    const answer = checker.check()

    await vi.advanceTimersByTimeAsync(600)

    await expect(answer).resolves.toEqual({ kind: 'latest' })
  })

  it('available: offers the next minor version and can download it', async () => {
    const checker = devChecker('?aboutUpdate=available')!
    const answer = checker.check()
    await vi.advanceTimersByTimeAsync(600)
    const [major, minor] = APP_VERSION.split('.').map(Number)

    await expect(answer).resolves.toEqual({ kind: 'available', version: `${major}.${minor! + 1}.0` })
    expect(checker.download).toBeTypeOf('function')
  })

  it('available: still offers the next minor version when the current one is a release candidate (1.0.0-rc.1)', async () => {
    const checker = devChecker('?aboutUpdate=available', '1.0.0-rc.1')!
    const answer = checker.check()
    await vi.advanceTimersByTimeAsync(600)

    await expect(answer).resolves.toEqual({ kind: 'available', version: '1.1.0' })
  })

  it('error: fails after a moment', async () => {
    const answer = devChecker('?aboutUpdate=error')!.check()
    const failure = expect(answer).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(600)

    await failure
  })

  it('slow: takes five seconds to say up to date', async () => {
    const answer = devChecker('?aboutUpdate=slow')!.check()
    let settled = false
    void answer.then(() => (settled = true))

    await vi.advanceTimersByTimeAsync(4999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })
})

describe('which checker the app uses', () => {
  it('is the shipped one unless a dev build was asked for a state', () => {
    expect(appUpdateChecker()).toBe(unavailableChecker)

    window.history.replaceState({}, '', '/?aboutUpdate=error')
    expect(appUpdateChecker()).not.toBe(unavailableChecker)
  })

  it('ignores the parameter in a production build', () => {
    vi.stubEnv('DEV', false)
    window.history.replaceState({}, '', '/?aboutUpdate=error')

    expect(appUpdateChecker()).toBe(unavailableChecker)
  })
})
