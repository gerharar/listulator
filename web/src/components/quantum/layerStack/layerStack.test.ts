import { describe, expect, it } from 'vitest'
import {
  resolveTabLabel,
  MAX_DEPTH,
  MAX_DEPTH_WITH_PREVIEW,
  popLayer,
  popToIndex,
  pushLayer,
  replaceTopLayer,
  visibleLayers,
  type LayerDescriptor,
} from './layerStack.js'

function layer(id: string, kind = 'screen'): LayerDescriptor {
  return { id, kind, tabLabel: id, content: null }
}

describe('pushLayer', () => {
  it('adds a layer on top of the stack', () => {
    const stack = [layer('home')]
    expect(pushLayer(stack, layer('list'))).toEqual([layer('home'), layer('list')])
  })

  it('does not mutate the stack it was given', () => {
    const stack = [layer('home')]
    pushLayer(stack, layer('list'))
    expect(stack).toEqual([layer('home')])
  })

  it('caps depth at 3, dropping the layer just above Home to make room — Home never drops', () => {
    const stack = [layer('home'), layer('cat'), layer('list-a')]
    const result = pushLayer(stack, layer('list-b'))

    expect(result).toEqual([layer('home'), layer('list-a'), layer('list-b')])
    expect(result[0]?.id).toBe('home')
    expect(result).toHaveLength(MAX_DEPTH)
  })

  it('allows a 4th layer when the one being pushed is a preview', () => {
    const stack = [layer('home'), layer('cat'), layer('list')]
    const result = pushLayer(stack, layer('preview-1', 'preview'))

    expect(result).toHaveLength(MAX_DEPTH_WITH_PREVIEW)
    expect(result.map((l) => l.id)).toEqual(['home', 'cat', 'list', 'preview-1'])
  })

  it('still caps a preview push at 4, dropping from just above Home', () => {
    const stack = [layer('home'), layer('a'), layer('b'), layer('c')]
    const result = pushLayer(stack, layer('preview-1', 'preview'))

    expect(result).toHaveLength(MAX_DEPTH_WITH_PREVIEW)
    expect(result[0]?.id).toBe('home')
    expect(result.at(-1)?.id).toBe('preview-1')
  })
})

describe('popLayer', () => {
  it('removes the top layer', () => {
    const stack = [layer('home'), layer('list')]
    expect(popLayer(stack)).toEqual([layer('home')])
  })

  it('does nothing at depth 1 — Home can never be popped', () => {
    const stack = [layer('home')]
    expect(popLayer(stack)).toEqual([layer('home')])
  })

  it('does not mutate the stack it was given', () => {
    const stack = [layer('home'), layer('list')]
    popLayer(stack)
    expect(stack).toEqual([layer('home'), layer('list')])
  })
})

describe('popToIndex', () => {
  it('pops directly to a given depth — a LayerTab back target', () => {
    const stack = [layer('home'), layer('cat'), layer('list'), layer('item')]
    expect(popToIndex(stack, 1)).toEqual([layer('home'), layer('cat')])
  })

  it('does nothing when given the index of the already-topmost layer', () => {
    const stack = [layer('home'), layer('list')]
    expect(popToIndex(stack, 1)).toEqual(stack)
  })

  it('does nothing for an out-of-range index', () => {
    const stack = [layer('home'), layer('list')]
    expect(popToIndex(stack, 5)).toEqual(stack)
    expect(popToIndex(stack, -1)).toEqual(stack)
  })
})

describe('replaceTopLayer', () => {
  it('swaps the top layer without changing depth', () => {
    const stack = [layer('home'), layer('create')]
    expect(replaceTopLayer(stack, layer('list-42'))).toEqual([layer('home'), layer('list-42')])
  })
})

describe('visibleLayers', () => {
  it('shows everything when the stack is at or under the peek depth', () => {
    const stack = [layer('home'), layer('cat'), layer('list')]
    expect(visibleLayers(stack)).toEqual(stack)
  })

  it('shows only the top 3 (active + two peeking) once a 4th (preview) layer is pushed', () => {
    const stack = [layer('home'), layer('cat'), layer('list'), layer('preview-1', 'preview')]
    expect(visibleLayers(stack).map((l) => l.id)).toEqual(['cat', 'list', 'preview-1'])
  })
})

describe('resolveTabLabel', () => {
  it('returns a plain label as it is', () => {
    expect(resolveTabLabel('My Lists')).toBe('My Lists')
  })

  it('asks a lazy label at the moment it is shown, so it can follow a language change', () => {
    let word = 'Settings'
    const label = () => word

    expect(resolveTabLabel(label)).toBe('Settings')
    word = 'Настройки'
    expect(resolveTabLabel(label)).toBe('Настройки')
  })
})
