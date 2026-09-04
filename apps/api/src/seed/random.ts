/**
 * The seed's only source of randomness, and it is not random (F2).
 *
 * **Idempotency is the reason this file exists.** `pnpm db:seed` has to be safe
 * to run twice, and "safe" cannot mean "deletes everything and rebuilds" —
 * that would throw away whatever a person was looking at. It means the second
 * run has to *recognise* what the first one wrote, and the only way to
 * recognise a generated brand is to generate the same one again. A generator
 * seeded from the clock, or from `Math.random`, produces a different catalogue
 * every run and turns idempotency into deduplication guesswork.
 *
 * So every draw comes from here, and every stream is named. Two calls with the
 * same name produce the same sequence in a fresh process, on another machine,
 * a month later.
 *
 * **Why not `@faker-js/faker`.** It can be seeded, so that is not the reason.
 * The reason is that the vocabulary it would supply — Korean person names and
 * addresses — is not the vocabulary a fashion catalogue needs, so the words are
 * hand-written either way (`vocabulary.ts`) and faker's remaining contribution
 * is the twenty lines below.
 */

/**
 * mulberry32 — 32-bit state, one multiply-shift round.
 *
 * Chosen for being short enough to read in one sitting and to have no state a
 * reader has to trust. Its statistical quality is far beyond what picking a
 * sleeve length needs; what matters here is that it is **exactly reproducible**
 * and has no dependency.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0

    let t = state

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * FNV-1a over the stream name.
 *
 * A named stream rather than one shared generator: the products drawn must not
 * change because the number of sellers did. With one generator, adding a seller
 * shifts every later draw and the whole catalogue is rewritten — which looks
 * like the seed is not idempotent when the only thing that changed is an
 * unrelated count.
 */
function hashSeed(name: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}

/** A named, reproducible source of draws. */
export interface SeededRandom {
  /** `[0, 1)`. */
  next(): number
  /** `[min, max]`, both ends included. */
  int(min: number, max: number): number
  /** One element. Throws on an empty list — an empty pool is a bug in the data. */
  pick<T>(items: readonly T[]): T
  /** `count` distinct elements, or every element when the list is shorter. */
  sample<T>(items: readonly T[], count: number): readonly T[]
  /** True with probability `p`. */
  chance(p: number): boolean
  /** A child stream, so a nested loop cannot disturb its parent's sequence. */
  stream(name: string): SeededRandom
}

export function seededRandom(name: string): SeededRandom {
  const next = mulberry32(hashSeed(name))

  const api: SeededRandom = {
    next,

    int(min, max) {
      if (max < min) throw new Error(`빈 범위입니다: [${String(min)}, ${String(max)}]`)

      return min + Math.floor(next() * (max - min + 1))
    },

    pick(items) {
      // The emptiness test comes first so that an empty pool reports *that*,
      // rather than `int(0, -1)` reporting an inverted range — which is true
      // but describes a symptom two frames away from the mistake.
      const chosen = items.length === 0 ? undefined : items[api.int(0, items.length - 1)]

      if (chosen === undefined) throw new Error('빈 목록에서는 고를 수 없습니다.')

      return chosen
    },

    sample<T>(items: readonly T[], count: number): readonly T[] {
      // Draw and remove, rather than shuffle in place: `pick` in a loop would
      // repeat, and every caller here means "three *distinct* colours". Splice
      // returns the removed element, so there is no index that the type system
      // has to be told cannot be `undefined`.
      const pool = [...items]
      const taken: T[] = []
      const take = Math.min(count, pool.length)

      for (let index = 0; index < take; index += 1) {
        taken.push(...pool.splice(api.int(0, pool.length - 1), 1))
      }

      return taken
    },

    chance(p) {
      return next() < p
    },

    stream(child) {
      return seededRandom(`${name}/${child}`)
    },
  }

  return api
}
