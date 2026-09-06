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

/**
 * What an upload is for.
 *
 * **A purpose is a prefix and an owner, together.** `product-image` lands under
 * `products/{sellerId}/…` and is authorised against a store; `return-photo`
 * lands under `returns/{userId}/…` and is authorised against the person asking.
 * Splitting them here rather than parameterising one purpose is what keeps a
 * buyer from ever being handed a key inside a seller's prefix — the request
 * shape for each purpose carries only what that owner needs (TASK-0067 F2).
 */
export const uploadPurposes = ['product-image', 'return-photo'] as const

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
 * 한 반품에 붙일 수 있는 사진의 수.
 *
 * **다섯인 이유.** 판매자가 하자를 판단하는 데 필요한 것은 「전체 · 하자 부위 ·
 * 가까이 · 라벨 · 포장」 다섯 장이면 끝난다. 그보다 많이 받아도 판단은 나아지지
 * 않고, 대신 상한이 없으면 신청 한 번이 **업로드 무제한**이 된다 —
 * `CLAIM_MAX_ITEMS` 가 조건부 갱신 100개를 10만 개로 만들지 않으려고 있는 것과
 * 같은 축이다.
 *
 * **강제하는 곳은 계약이 아니라 규칙이다** (`returnPhotoDecision`). 스키마에
 * `.max()` 로 걸면 여섯 번째 장이 이름 없는 필드 오류가 되어 화면이 「몇 장까지」로
 * 바꿔 말할 수 없고, 그때 이 코드(`RETURN_PHOTO_TOO_MANY`)와 그것이 싣는
 * `params.max` 는 아무도 받지 못하는 것이 된다 — 자세한 이유는
 * `claimReturnDetailsSchema.photoKeys` 에 있다.
 */
export const RETURN_PHOTO_MAX_COUNT = 5

/**
 * `returns/{userId}/{objectId}.{ext}`.
 *
 * **접두어가 판매자가 아니라 신청한 사람**인 것이 `productImageKeyPattern` 과 다른
 * 유일한 점이고, 그 차이가 이 열쇠의 전부다.
 *
 * ① 사진은 **신청서를 만들기 전에** 올라간다. 그때는 클레임 id 가 없으므로 열쇠가
 *    클레임을 가리킬 수 없고, 가리키게 만들려면 「빈 신청서를 먼저 만든다」가 되어
 *    사진 없는 하자 반품이 정상 상태로 존재하는 구간이 생긴다.
 * ② 열쇠 하나만 보고 **누구 것인지** 말할 수 있어야 한다. 그래야 「이 신청서에 이
 *    사진을 붙여도 되는가」를 두 번째 조회 없이 판정하고, 남의 사진을 자기
 *    신청서에 붙이는 요청이 조용히 통과하지 않는다.
 *
 * **두 열쇠 규칙이 한 파일에 있는 것이 요점이다.** 접두어와 그것을 승인하는 주인은
 * 짝이고, 그 짝이 갈라져 있으면 발급하는 쪽(`upload-rules.ts`)과 검사하는 쪽
 * (`return-rules.ts` · `ReturnPhoto_key_format_check`)이 서로 다른 모양을 믿게 된다.
 */
export const returnPhotoKeyPattern = new RegExp(
  `^returns/${UUID}/${UUID}\\.(?:${uploadImageExtensions.join('|')})$`,
)

export const returnPhotoKeySchema = z.string().regex(returnPhotoKeyPattern)

/** 목적과 무관하게 늘 필요한 것 — 무엇을, 어떤 형식으로, 몇 바이트. */
const presignUploadFields = {
  filename: uploadFilenameSchema,
  contentType: uploadContentTypeSchema,
  /** Exact byte length of the file about to be uploaded. */
  size: uploadSizeSchema,
}

/**
 * Body of `POST /api/v1/uploads/presign`.
 *
 * `size` is declared rather than measured because the API never sees the file.
 * It is not taken on trust either: the value is signed into the URL as
 * `content-length`, so an upload of any other length is refused by the storage
 * itself (TASK-0011 4.3).
 *
 * **목적으로 갈라지는 합집합이다.** 상품 이미지는 어느 스토어의 것인지 말해야 하고
 * (`sellerId`), 반품 사진은 **아무것도 말하지 않는다** — 주인은 토큰이 정한다. 뒤엣
 * 것에 소유자 칸을 두면 「남의 id 를 적어 보는」 요청이 생기고, 그 요청을 막는 검사가
 * 하나 더 필요해진다. 없는 칸은 막을 필요가 없다 (TASK-0067 F2).
 */
export const presignUploadRequestSchema = z.discriminatedUnion('purpose', [
  z.object({
    purpose: z.literal('product-image'),
    /** The store the object will belong to. Checked against the caller's scope. */
    sellerId: z.uuid(),
    ...presignUploadFields,
  }),
  z.object({
    purpose: z.literal('return-photo'),
    ...presignUploadFields,
  }),
])

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
  /**
   * 목적이 정한 모양의 열쇠.
   *
   * 합집합이라 **부르는 쪽이 되받은 열쇠를 검사할 수 있다** — 반품 사진을 청했는데
   * `products/…` 가 돌아오면 그것을 신청서에 붙이는 자리에서 걸린다.
   */
  key: z.union([productImageKeySchema, returnPhotoKeySchema]),
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
