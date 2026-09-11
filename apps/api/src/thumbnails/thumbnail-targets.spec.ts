import { describe, expect, it } from 'vitest'
import { thumbnailTargets } from './thumbnail-targets.js'
const sellerId = '11111111-1111-4111-8111-111111111111'
const key = `products/${sellerId}/22222222-2222-4222-8222-222222222222.png`
const storage = {
  endpoint: 'https://r2.example',
  publicBaseUrl: 'https://cdn.example',
  bucket: 'images',
  region: 'auto',
  accessKeyId: 'test',
  secretAccessKey: 'test',
}
const job = { id: sellerId, token: sellerId, sellerId, sourceUrl: `https://cdn.example/${key}` }
describe('thumbnail source ownership', () => {
  it('signs only configured storage requests and keeps output keys deterministic', () => {
    const first = thumbnailTargets(job, storage, new Date('2026-09-11T00:00:00Z'))
    const second = thumbnailTargets(job, storage, new Date('2026-09-11T00:01:00Z'))
    expect(new URL(first.sourceUrl).origin).toBe(storage.endpoint)
    expect(first.targets.map((x) => x.publicUrl)).toEqual(second.targets.map((x) => x.publicUrl))
    expect(first.targets.map((x) => x.edge)).toEqual([256, 768])
  })
  it('rejects foreign hosts, owners, path traversal and unknown keys', () => {
    for (const sourceUrl of [
      `https://evil.example/${key}`,
      `https://cdn.example.evil/${key}`,
      `https://cdn.example/${key}?redirect=evil`,
      'https://cdn.example/seed/a.svg',
      `https://cdn.example/products/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222.png`,
    ]) {
      expect(() =>
        thumbnailTargets({ ...job, sourceUrl }, storage, new Date('2026-09-11T00:00:00Z')),
      ).toThrow('foreign_source')
    }
  })
})
