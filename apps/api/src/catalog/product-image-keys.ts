import { productImageKeyPattern } from '@shopping/shared'

/**
 * Reading a storage key back out of an image URL (TASK-0113 4장).
 *
 * **Why anything needs to.** TASK-0033 F6 handed this task the job of deciding
 * how an uploaded object that never became a `ProductImage` row gets deleted.
 * The answer is a bucket sweep — list `products/{sellerId}/`, subtract the keys
 * live rows point at, delete what is left — because presign creates the object
 * *before* any row exists, so nothing a client does can be relied on to clean up
 * after itself (the browser gets closed).
 *
 * That sweep is only safe if the prefix means what it says. If seller A's
 * product may reference `products/{B}/…`, then B's sweep deletes an object A is
 * displaying. So a save has to refuse a key belonging to another store, and this
 * is the function that recognises one.
 *
 * Pure: no clock, no configuration, no storage client. In particular it does not
 * ask `ObjectStorage.publicUrl` what our base URL is — that binding throws when
 * R2 is unconfigured (a supported state, TASK-0011 4.5), and a product save that
 * failed because the bucket has no credentials would be a strange way to learn
 * about it.
 */

/** Segment count of `products/{sellerId}/{objectId}.{ext}`. */
const KEY_PREFIX = 'products/'

/**
 * The path part of a URL, with no leading slash.
 *
 * A relative value is its own path. Callers send whatever the presign response
 * gave them, which is absolute — but `url` is only constrained to be a non-empty
 * string, and treating a relative one as unparseable would make the check pass
 * for the one shape it is easiest to hand-write.
 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, '')
  } catch {
    return url.replace(/^\//, '')
  }
}

/**
 * The store an image URL belongs to, or `null` when the URL is not one of ours.
 *
 * `null` is not a refusal. The catalogue is seeded with stock photography from
 * Unsplash and Pexels (DECISIONS 13), whose URLs are nobody's product key and
 * which no sweep will ever touch. What the check is for is the URL that *does*
 * parse as one of our keys while naming somebody else's store.
 *
 * The whole key is matched against the shared pattern rather than split on
 * slashes, so the shape this accepts is exactly the shape `productImageKey`
 * produces — a UUID store, a UUID object, a known extension.
 */
export function productImageOwner(url: string): string | null {
  const path = pathOf(url)
  const start = path.lastIndexOf(KEY_PREFIX)

  if (start < 0) return null

  const key = path.slice(start)

  if (!productImageKeyPattern.test(key)) return null

  return key.slice(KEY_PREFIX.length).split('/')[0] ?? null
}

/** Positions of the images that name a store other than `sellerId`. */
export function foreignImageIndexes(
  images: readonly { readonly url: string }[],
  sellerId: string,
): readonly number[] {
  return images.flatMap((image, index) => {
    const owner = productImageOwner(image.url)

    return owner !== null && owner !== sellerId ? [index] : []
  })
}
