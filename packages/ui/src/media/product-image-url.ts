import keys from './seed-image-keys.json'

const available = new Set<string>(keys)
const LEGACY_SEED = /^https:\/\/cdn\.demo-shopping\.com\/seed\/catalog\/([a-f0-9]{32}\.svg)$/

/** Same bytes and content hash as the snapshot; never substitute a different product image. */
export function productImageUrl(src: string): string {
  const file = LEGACY_SEED.exec(src)?.[1]
  return file !== undefined && available.has(file) ? `/seed/catalog/${file}` : src
}
