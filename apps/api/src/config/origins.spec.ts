import { describe, expect, it } from 'vitest'

import { parseOriginList } from './origins.js'

describe('parseOriginList', () => {
  it('splits, trims and keeps declaration order', () => {
    const { origins, invalid } = parseOriginList(
      'http://localhost:3040, http://localhost:3041 ,http://localhost:3042',
    )

    expect(origins).toEqual([
      'http://localhost:3040',
      'http://localhost:3041',
      'http://localhost:3042',
    ])
    expect(invalid).toEqual([])
  })

  it('normalises a trailing slash so byte comparison against Origin still matches', () => {
    expect(parseOriginList('http://localhost:3040/').origins).toEqual(['http://localhost:3040'])
  })

  it('de-duplicates', () => {
    expect(parseOriginList('http://localhost:3040,http://localhost:3040/').origins).toHaveLength(1)
  })

  it('returns an empty list for an empty variable', () => {
    expect(parseOriginList('').origins).toEqual([])
    expect(parseOriginList(' , ').origins).toEqual([])
  })

  it('reports entries that are not an http(s) origin', () => {
    const { origins, invalid } = parseOriginList('http://localhost:3040,localhost:3041,ftp://x.dev')

    expect(origins).toEqual(['http://localhost:3040'])
    expect(invalid).toEqual(['localhost:3041', 'ftp://x.dev'])
  })
})
