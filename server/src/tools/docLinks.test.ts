import { describe, expect, it } from 'vitest'
import { brokenLinks, localLinks } from './docLinks.js'

const tracked = new Set(['README.md', 'SECURITY.md', 'LICENSE', 'lists/LICENSE', 'web/src/locale/en.ts', 'docs/guide/start.md'])

describe('localLinks', () => {
  it('finds inline links to files, with their line numbers, and ignores web addresses and mail', () => {
    const text = ['See [the licence](LICENSE) and [site](https://example.com/a).', '', 'Write to [me](mailto:a@b.c).'].join('\n')

    expect(localLinks(text)).toEqual([{ target: 'LICENSE', line: 1 }])
  })

  it('drops a #fragment and a ?query, and reads a link with a title', () => {
    const text = '[a](SECURITY.md#which-versions) and [b](README.md?plain=1 "the readme")'

    expect(localLinks(text).map((link) => link.target)).toEqual(['SECURITY.md', 'README.md'])
  })

  it('reads a link written with angle brackets, and one with a space in the path', () => {
    expect(localLinks('[x](<docs/my file.md>)').map((link) => link.target)).toEqual(['docs/my file.md'])
  })

  it('ignores a link-shaped thing inside a code span or a fenced block', () => {
    const text = ['Use `[a](nope.md)` like that.', '```', '[b](nope.md)', '```', '[c](LICENSE)'].join('\n')

    expect(localLinks(text)).toEqual([{ target: 'LICENSE', line: 5 }])
  })

  it('ignores a link that only points inside the page', () => {
    expect(localLinks('[top](#top)')).toEqual([])
  })

  it('finds a reference-style definition too', () => {
    expect(localLinks('[licence]: LICENSE\n[gone]: tasks/plan.md')).toEqual([
      { target: 'LICENSE', line: 1 },
      { target: 'tasks/plan.md', line: 2 },
    ])
  })
})

describe('brokenLinks', () => {
  it('names every link whose file is not in the repository, with where it was written', () => {
    const text = ['[ok](LICENSE)', '[gone](SPEC.md)', '[also gone](tasks/plan.md)'].join('\n')

    expect(brokenLinks('README.md', text, tracked)).toEqual([
      'README.md:2 links to SPEC.md, which is not a file in the repository',
      'README.md:3 links to tasks/plan.md, which is not a file in the repository',
    ])
  })

  it('resolves a link from the folder of the file that holds it', () => {
    expect(brokenLinks('docs/guide/other.md', '[here](start.md) [up](../../README.md) [bad](../start.md)', tracked)).toEqual([
      'docs/guide/other.md:1 links to docs/start.md, which is not a file in the repository',
    ])
  })

  it('accepts a link to a folder only when something tracked is in it', () => {
    expect(brokenLinks('README.md', '[lists](lists/) [none](nothing/)', tracked)).toEqual([
      'README.md:1 links to nothing, which is not a file in the repository',
    ])
  })

  it('treats a link that climbs out of the repository as broken', () => {
    expect(brokenLinks('README.md', '[x](../outside.md)', tracked)).toHaveLength(1)
  })

  it('does not count a file that exists only on this computer (not tracked) as public', () => {
    expect(brokenLinks('README.md', '[spec](SPEC.md)', tracked)).toHaveLength(1)
  })
})
