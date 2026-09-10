/** Reproduce byte-identical catalogue SVGs. Run after the API build; --check never writes. */
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { seedPlaceholderAssets } from '../dist/seed/images.js'
import { leafCategories } from '../dist/seed/taxonomy.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const assets = new Map(
  leafCategories()
    .flatMap((c) => seedPlaceholderAssets(c.slug, c.name))
    .map((a) => [a.key, a.bytes]),
)
const check = process.argv.includes('--check')
const keys = [...assets.keys()].sort()
for (const key of keys) {
  const bytes = assets.get(key)
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  if (key !== `seed/catalog/${hash}.svg`) throw new Error('Content-address mismatch')
  const path = resolve(root, 'apps/shop/public', key)
  if (check) {
    if (!(await readFile(path)).equals(bytes)) throw new Error(`Changed bytes: ${key}`)
  } else {
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, bytes)
  }
}
const manifest =
  JSON.stringify(
    keys.map((key) => key.split('/').at(-1)),
    null,
    2,
  ) + '\n'
const manifestPath = resolve(root, 'apps/shop/src/lib/products/seed-image-keys.json')
if (check) {
  if ((await readFile(manifestPath, 'utf8')) !== manifest) throw new Error('Manifest differs')
  const actual = (await readdir(resolve(root, 'apps/shop/public/seed/catalog'))).sort()
  if (JSON.stringify(actual) !== JSON.stringify(keys.map((k) => k.split('/').at(-1))))
    throw new Error('Unexpected assets')
} else await writeFile(manifestPath, manifest)
console.log(`${check ? 'Verified' : 'Exported'} ${keys.length} byte-identical seed SVGs`)
