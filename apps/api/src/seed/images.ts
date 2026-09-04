import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import type { ObjectStorage } from '../storage/object-storage.js'
import { findRepoRoot } from '../config/workspace.js'
import type { SeededRandom } from './random.js'
import { sectionOf } from './pricing.js'

/**
 * Where the catalogue's pictures come from (TASK-0037 4장, 2026-09-05 보강).
 *
 * **The seed does not procure photographs. It makes a place for them.** The
 * two-layer strategy the task approved — AI generation for 20 showcase
 * listings, collected stock for the other 780 — describes *what pictures are
 * needed*. It cannot describe where they come from, because that is a person's
 * job: nothing here can generate a photograph or agree to a licence.
 *
 * If the seed refused to run without them, everything else — 40 categories, 15
 * stores, 800 listings, 3,000 combinations, the ledger behind every one of them
 * — would be blocked behind an errand. So:
 *
 * | `assets/seed-images/` 에 | 이 파일이 |
 * | --- | --- |
 * | 사진이 있다 | 그대로 올린다. 내용 해시로 키를 잡아 **한 번만** 올라간다 |
 * | 없다 | 카테고리 색으로 칠한 SVG 를 만들어 같은 자리에 넣는다 |
 *
 * Both go through the same code, so dropping the photographs in and rerunning
 * `pnpm db:seed` changes the image URLs and nothing else (F6d).
 *
 * **The placeholder does not pretend to be a photograph.** It is a flat colour
 * block with the category written on it. A blurry fake would be worse than an
 * obvious placeholder: it would make the catalogue look broken rather than
 * unfinished, and the task's own instruction is to say plainly which pictures
 * were generated.
 */

/** Where a person drops the real pictures. Not committed — see `.gitignore`. */
const ASSET_DIR = 'assets/seed-images'

/** How many pictures each leaf category's pool holds. */
const POOL_SIZE = 6

/** Extensions the uploader knows a content type for. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

/** One picture, once it has a URL. */
export interface SeedImage {
  readonly url: string
  readonly alt: string
}

/** A picture before it is uploaded: bytes, and what to call the file. */
interface PendingImage {
  readonly bytes: Buffer
  readonly extension: string
  readonly alt: string
}

/**
 * The hue each section is drawn in.
 *
 * Per section rather than per leaf so a category listing reads as one surface —
 * F6c ("썸네일 톤이 어긋나 보이지 않음") is about the page, not the picture, and
 * 26 unrelated hues in a grid is exactly the mismatch it names.
 */
const SECTION_HUES: Readonly<Record<string, number>> = {
  tops: 210,
  bottoms: 224,
  outer: 24,
  shoes: 12,
  bags: 40,
  accessories: 160,
}

/** A flat, honest placeholder: the category, on a colour, at 4:5. */
function placeholderSvg(leafName: string, leafSlug: string, index: number): string {
  const hue = SECTION_HUES[sectionOf(leafSlug)] ?? 200
  const light = 94 - index * 4
  const ink = 34
  const background = `hsl(${String(hue)} 24% ${String(light)}%)`
  const foreground = `hsl(${String(hue)} 30% ${String(ink)}%)`

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">',
    `<rect width="800" height="1000" fill="${background}"/>`,
    `<rect x="220" y="250" width="360" height="500" rx="28" fill="${foreground}" opacity="0.08"/>`,
    `<text x="400" y="530" text-anchor="middle" font-family="system-ui, sans-serif"`,
    ` font-size="52" fill="${foreground}">${leafName}</text>`,
    `<text x="400" y="596" text-anchor="middle" font-family="system-ui, sans-serif"`,
    ` font-size="26" fill="${foreground}" opacity="0.65">샘플 이미지</text>`,
    '</svg>',
  ].join('')
}

/** The files a person dropped for one pool, or nothing. */
function assetsFor(repoRoot: string, kind: 'stock' | 'showcase', key: string): readonly string[] {
  const dir = join(repoRoot, ASSET_DIR, kind, key)

  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((name) => extname(name).toLowerCase() in CONTENT_TYPES)
    .sort()
    .map((name) => join(dir, name))
}

/** Which pictures a pool is made of — collected if present, generated if not. */
function pendingFor(
  repoRoot: string | null,
  leafSlug: string,
  leafName: string,
): readonly PendingImage[] {
  const files = repoRoot === null ? [] : assetsFor(repoRoot, 'stock', leafSlug)

  if (files.length > 0) {
    return files.map((file, index) => ({
      bytes: readFileSync(file),
      extension: extname(file).toLowerCase(),
      alt: `${leafName} 사진 ${String(index + 1)}`,
    }))
  }

  return Array.from({ length: POOL_SIZE }, (_unused, index) => ({
    bytes: Buffer.from(placeholderSvg(leafName, leafSlug, index), 'utf8'),
    extension: '.svg',
    alt: `${leafName} 샘플 이미지 ${String(index + 1)}`,
  }))
}

/**
 * The key an image is stored under.
 *
 * **`seed/catalog/`, not `products/<sellerId>/`.** That prefix means "a seller
 * uploaded this", and `assertOwnImages` checks the id in it against the store
 * being written (TASK-0113 F14). A seed picture is a catalogue asset the 15
 * stores share, so keying it under one of them would make it unusable by the
 * other 14. Keys outside `products/` have no owner and pass the check, which is
 * also what is true.
 *
 * The name is the content hash, so the same bytes are one object however many
 * listings point at it, and a rerun writes the same key.
 */
function keyFor(image: PendingImage): string {
  const digest = createHash('sha256').update(image.bytes).digest('hex').slice(0, 32)

  return `seed/catalog/${digest}${image.extension}`
}

export interface ImageUploadReport {
  readonly uploaded: number
  readonly reused: number
  /** Set when the store is unconfigured — the seed then runs without pictures. */
  readonly skipped: string | null
}

/**
 * Uploads what a catalogue needs and answers a pool per leaf category.
 *
 * Built once and reused: the pools are shared across all 800 listings, so the
 * upload happens once per distinct picture rather than once per listing.
 */
export class SeedImages {
  private readonly pools = new Map<string, readonly SeedImage[]>()
  private uploaded = 0
  private reused = 0
  private skipped: string | null = null

  constructor(
    private readonly storage: ObjectStorage,
    private readonly now: () => Date,
    private readonly repoRoot: string | null = findRepoRoot(),
  ) {}

  /** Whether a person has dropped any pictures in — reported, not decided on. */
  hasAssets(): boolean {
    return this.repoRoot !== null && existsSync(join(this.repoRoot, ASSET_DIR))
  }

  report(): ImageUploadReport {
    return { uploaded: this.uploaded, reused: this.reused, skipped: this.skipped }
  }

  /** The pool for one leaf category, uploading it the first time it is asked for. */
  async pool(leafSlug: string, leafName: string): Promise<readonly SeedImage[]> {
    const held = this.pools.get(leafSlug)

    if (held !== undefined) return held

    const built = await this.upload(pendingFor(this.repoRoot, leafSlug, leafName))

    this.pools.set(leafSlug, built)

    return built
  }

  private async upload(images: readonly PendingImage[]): Promise<readonly SeedImage[]> {
    if (this.skipped !== null) return []

    const done: SeedImage[] = []

    for (const image of images) {
      const url = await this.put(image)

      if (url === null) return []

      done.push({ url, alt: image.alt })
    }

    return done
  }

  /** One object. `null` once the storage has told us it is not configured. */
  private async put(image: PendingImage): Promise<string | null> {
    const key = keyFor(image)
    const contentType = CONTENT_TYPES[image.extension] ?? 'application/octet-stream'

    let target
    try {
      target = this.storage.presignUpload({
        key,
        contentType,
        contentLength: image.bytes.byteLength,
        now: this.now(),
        expiresInSeconds: 600,
      })
    } catch {
      // `UnconfiguredObjectStorage` refuses here. An environment with no R2
      // credentials still has every other thing the seed makes, and failing the
      // whole run would take those away too.
      this.skipped = 'R2 가 설정되지 않아 이미지 없이 진행합니다.'

      return null
    }

    // Content-addressed, so an object that is already there is already correct.
    const head = await fetch(target.publicUrl, { method: 'HEAD' })

    if (head.ok) {
      this.reused += 1

      return target.publicUrl
    }

    const response = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: { ...target.headers, 'content-length': String(image.bytes.byteLength) },
      body: new Uint8Array(image.bytes),
    })

    if (!response.ok) {
      throw new Error(`이미지 업로드에 실패했습니다 (${String(response.status)}): ${key}`)
    }

    this.uploaded += 1

    return target.publicUrl
  }
}

/** How many pictures a listing shows: showcase listings get the full gallery. */
export function galleryFor(
  random: SeededRandom,
  pool: readonly SeedImage[],
  showcase: boolean,
): readonly SeedImage[] {
  if (pool.length === 0) return []

  const count = showcase ? Math.min(pool.length, random.int(4, 5)) : random.int(1, 2)

  return random.sample(pool, count)
}
