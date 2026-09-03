import { z } from 'zod'

/**
 * Direct-to-storage uploads, as the API states them (TASK-0011).
 *
 * The image bytes never pass through the API: the browser asks for a presigned
 * URL, gets one back, and PUTs the file straight at object storage. That is a
 * deployment requirement rather than an optimisation — the API runs on a free
 * Render instance with 512MB and scale-to-zero, and a handful of concurrent 5MB
 * uploads through the process is enough to kill it.
 *
 * Contract gate C1: these schemas are the only definition of an upload request
 * or response in the repository. `apps/api` validates its input with them and
 * the front-ends parse their answers with them.
 */

/** What an upload is for. Only product images exist today (TASK-0011 2장). */
export const uploadPurposes = ['product-image'] as const

export type UploadPurpose = (typeof uploadPurposes)[number]

export const uploadPurposeSchema = z.enum(uploadPurposes)

/**
 * The MIME types a product image may declare.
 *
 * `image/gif` and `image/svg+xml` are deliberately absent — SVG is executable
 * in a browser and becomes a stored-XSS vector the moment it is served from a
 * domain of ours.
 */
export const uploadContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const

export type UploadContentType = (typeof uploadContentTypes)[number]

export const uploadContentTypeSchema = z.enum(uploadContentTypes)

/**
 * Which extensions each MIME type may carry.
 *
 * A map rather than two independent lists because the two have to agree: a
 * request claiming `image/png` for a `.jpg` file is either a mistake or an
 * attempt to get a mismatched object into the bucket, and there is no way to
 * decide that without knowing which extensions belong to which type.
 *
 * Typed as a total `Record`, so adding a content type above and forgetting it
 * here stops compiling rather than silently accepting nothing.
 */
export const uploadImageFormats: Readonly<Record<UploadContentType, readonly string[]>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
}

/** Every accepted extension, derived so the two lists cannot drift. */
export const uploadImageExtensions: readonly string[] = Object.values(uploadImageFormats)
  .flat()
  .sort()

/**
 * 5MB.
 *
 * Chosen against what the images actually are rather than against what a phone
 * can produce: a 2000px product photo is 300~700KB as WebP and rarely over 2MB
 * as JPEG, so 5MB accepts an unoptimised camera original and still refuses a
 * file that is clearly not a product photo. It also keeps the free R2 tier
 * (10GB) meaningful — 2,000 images at the cap.
 */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024

/**
 * 5 minutes.
 *
 * A presigned URL *is* the write permission, so its lifetime is how long a
 * leaked one stays useful. Five minutes covers picking a file and uploading it
 * over a slow connection — 5MB needs about 40 seconds at 1Mbps — with room to
 * spare, and is short enough that a URL in a log or a `Referer` header is
 * almost always already dead.
 */
export const UPLOAD_URL_TTL_SECONDS = 300

/**
 * The name the file had on the caller's machine.
 *
 * It never becomes part of the key — the server builds that from a UUID — and
 * is read for one thing only: the extension. Path separators and control
 * characters are refused anyway, because a filename that contains them is not a
 * filename a file picker produced.
 */
export const uploadFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  .regex(/^[^/\\\u0000-\u001f\u007f]+$/u)

export const uploadSizeSchema = z.int().positive().max(UPLOAD_MAX_BYTES)

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * `products/{sellerId}/{objectId}.{ext}`.
 *
 * The seller id is in the key so that a key alone says which store owns the
 * object — which is what lets a later request ("this product's image is at K")
 * be authorised without a second lookup, and what makes an accidental
 * cross-store reference visible rather than silent.
 */
export const productImageKeyPattern = new RegExp(
  `^products/${UUID}/${UUID}\\.(?:${uploadImageExtensions.join('|')})$`,
)

export const productImageKeySchema = z.string().regex(productImageKeyPattern)

/**
 * Body of `POST /api/v1/uploads/presign`.
 *
 * `size` is declared rather than measured because the API never sees the file.
 * It is not taken on trust either: the value is signed into the URL as
 * `content-length`, so an upload of any other length is refused by the storage
 * itself (TASK-0011 4.3).
 */
export const presignUploadRequestSchema = z.object({
  purpose: uploadPurposeSchema,
  /** The store the object will belong to. Checked against the caller's scope. */
  sellerId: z.uuid(),
  filename: uploadFilenameSchema,
  contentType: uploadContentTypeSchema,
  /** Exact byte length of the file about to be uploaded. */
  size: uploadSizeSchema,
})

export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>

/**
 * One presigned upload.
 *
 * `headers` and `contentLength` are part of the answer because they are part of
 * the *signature*: an upload that does not send exactly these is refused with
 * 403, and a caller has no other way to learn that. `Content-Length` is not in
 * `headers` because a browser sets it from the body and refuses to let script
 * set it — it is reported separately so a caller whose file changed since the
 * request knows to ask for a new URL rather than get an opaque 403.
 */
export const presignedUploadSchema = z.object({
  key: productImageKeySchema,
  /** Where to PUT the bytes. Carries the signature; treat it as a secret. */
  uploadUrl: z.url(),
  /** Where the object will be readable once the upload succeeds. */
  publicUrl: z.url(),
  method: z.literal('PUT'),
  /** Headers the upload must send verbatim. */
  headers: z.record(z.string(), z.string()),
  contentLength: z.int().positive(),
  /** After this instant the URL is refused by the storage. */
  expiresAt: z.iso.datetime(),
})

export type PresignedUpload = z.infer<typeof presignedUploadSchema>

export const presignUploadResponseSchema = z.object({ upload: presignedUploadSchema })

export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>
