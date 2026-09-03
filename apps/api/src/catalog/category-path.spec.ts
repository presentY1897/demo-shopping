import { describe, expect, it } from 'vitest'

import {
  depthOf,
  fitsUnder,
  isSelfOrDescendant,
  pathOf,
  rebasePath,
  refuseMove,
  ROOT_PATH,
} from './category-path.js'

/**
 * Pure logic, so gate Q5 asks for **branch** coverage of 100% here — every
 * refusal and every acceptance, from inputs alone.
 *
 * These are the rules a move is judged by. The database states them too, and
 * `test/db/category-constraints.spec.ts` proves it does; the difference is that
 * a violation there is a 500 with a SQLSTATE, while a violation caught here is a
 * 400 that tells the operator which rule they hit.
 */

describe('pathOf', () => {
  it('builds a root path from the id alone', () => {
    expect(pathOf(null, 7)).toBe('/7/')
    expect(ROOT_PATH).toBe('/')
  })

  it('appends the id to the parent path', () => {
    expect(pathOf('/1/', 5)).toBe('/1/5/')
    expect(pathOf('/1/5/', 12)).toBe('/1/5/12/')
  })
})

describe('depthOf', () => {
  it('counts the ids, not the slashes', () => {
    expect(depthOf('/7/')).toBe(1)
    expect(depthOf('/1/5/')).toBe(2)
    expect(depthOf('/1/5/12/')).toBe(3)
  })

  it('is unaffected by gaps in the numbering', () => {
    // Ids are never reused, so a path routinely skips numbers.
    expect(depthOf('/1/98/1204/')).toBe(3)
  })
})

describe('isSelfOrDescendant', () => {
  it('recognises the node itself', () => {
    expect(isSelfOrDescendant('/1/5/', '/1/5/')).toBe(true)
  })

  it('recognises a descendant', () => {
    expect(isSelfOrDescendant('/1/5/12/', '/1/5/')).toBe(true)
  })

  it('rejects an ancestor and a sibling', () => {
    expect(isSelfOrDescendant('/1/', '/1/5/')).toBe(false)
    expect(isSelfOrDescendant('/1/6/', '/1/5/')).toBe(false)
  })

  it('is not fooled by an id that merely starts with another', () => {
    // The trailing slash is what makes this a comparison of whole ids: without
    // it, `/1/5` would be a prefix of `/1/50/` and node 50 would look like a
    // descendant of node 5.
    expect(isSelfOrDescendant('/1/50/', '/1/5/')).toBe(false)
  })
})

describe('fitsUnder', () => {
  it('allows a subtree that ends at the third level', () => {
    expect(fitsUnder(0, 3)).toBe(true)
    expect(fitsUnder(1, 2)).toBe(true)
    expect(fitsUnder(2, 1)).toBe(true)
  })

  it('refuses one that would need a fourth', () => {
    expect(fitsUnder(1, 3)).toBe(false)
    expect(fitsUnder(3, 1)).toBe(false)
  })
})

describe('refuseMove', () => {
  const leaf = { path: '/1/5/12/', depth: 3, subtreeDepth: 3 }
  const branch = { path: '/1/5/', depth: 2, subtreeDepth: 3 }

  it('allows a move to the top level', () => {
    expect(refuseMove(branch, { path: null, depth: 0 })).toBeNull()
  })

  it('allows a move under an unrelated parent that leaves room', () => {
    expect(refuseMove(branch, { path: '/9/', depth: 1 })).toBeNull()
  })

  it('refuses moving a node under itself', () => {
    expect(refuseMove(branch, { path: '/1/5/', depth: 2 })).toBe('cycle')
  })

  it('refuses moving a node under its own descendant', () => {
    expect(refuseMove(branch, { path: '/1/5/12/', depth: 3 })).toBe('cycle')
  })

  it('refuses a move that would push the subtree past the third level', () => {
    // Two levels of subtree under a parent that is already at level 2.
    expect(refuseMove(branch, { path: '/9/8/', depth: 2 })).toBe('too_deep')
  })

  it('allows the same subtree under a parent one level higher', () => {
    expect(refuseMove(branch, { path: '/9/', depth: 1 })).toBeNull()
  })

  it('lets a leaf move to the deepest legal position', () => {
    expect(refuseMove(leaf, { path: '/9/8/', depth: 2 })).toBeNull()
  })

  it('checks the cycle before the depth, so the message names the real problem', () => {
    // A move under one's own deepest descendant is both. `cycle` is the useful
    // answer: "make it shallower" would be advice that cannot be followed.
    const root = { path: '/1/', depth: 1, subtreeDepth: 3 }

    expect(refuseMove(root, { path: '/1/5/12/', depth: 3 })).toBe('cycle')
  })
})

describe('rebasePath', () => {
  it('re-roots a subtree path', () => {
    expect(rebasePath('/1/5/12/', '/1/5/', '/9/5/')).toBe('/9/5/12/')
  })

  it('re-roots the moved node itself', () => {
    expect(rebasePath('/1/5/', '/1/5/', '/9/5/')).toBe('/9/5/')
  })

  it('handles a move to and from the top level', () => {
    expect(rebasePath('/1/5/12/', '/1/5/', '/5/')).toBe('/5/12/')
    expect(rebasePath('/5/12/', '/5/', '/1/5/')).toBe('/1/5/12/')
  })
})
