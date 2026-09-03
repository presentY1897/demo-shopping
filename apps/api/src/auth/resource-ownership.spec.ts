import { describe, expect, it } from 'vitest'

import { accountOwnership, accountOwnershipSelect } from './resource-ownership.js'

describe('accountOwnership', () => {
  it('makes an account the owner of itself', () => {
    expect(accountOwnership({ id: 'user-1', isDemo: false })).toEqual({
      ownerUserId: 'user-1',
      ownerSellerId: null,
      ownerIsDemo: false,
    })
  })

  it('carries the demo flag through, which is what the `demo` scope reads', () => {
    expect(accountOwnership({ id: 'demo-1', isDemo: true }).ownerIsDemo).toBe(true)
  })

  it('selects exactly the columns the mapper needs', () => {
    // The select fragment exists so that services never spell the columns out
    // themselves; if it stops matching the mapper, they would have to.
    expect(Object.keys(accountOwnershipSelect).sort()).toEqual(['id', 'isDemo'])
  })
})
