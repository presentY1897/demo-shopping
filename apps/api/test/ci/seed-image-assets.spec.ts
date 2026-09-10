import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { findRepoRoot } from '../../src/config/workspace.js'
import { seedPlaceholderAssets } from '../../src/seed/images.js'
import { leafCategories } from '../../src/seed/taxonomy.js'

it('keeps every served seed SVG byte-identical to the immutable catalogue image', () => {
  const assets = new Map(
    leafCategories()
      .flatMap((c) => seedPlaceholderAssets(c.slug, c.name))
      .map((a) => [a.key, a.bytes]),
  )
  const root = findRepoRoot()
  if (!root) throw new Error('Workspace root not found')
  const publicRoot = join(root, 'apps/shop/public')
  expect(readdirSync(join(publicRoot, 'seed/catalog')).sort()).toEqual(
    [...assets.keys()].map((key) => key.split('/').at(-1)).sort(),
  )
  for (const [key, bytes] of assets)
    expect(readFileSync(join(publicRoot, key)).equals(bytes), key).toBe(true)
})
