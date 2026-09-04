import { z } from 'zod'

/**
 * Seller onboarding, as the API states it (TASK-0108).
 *
 * A store is the only thing that grants `SELLER_OWNER`, and this file is the
 * only definition of what one looks like on the wire. `apps/api` validates its
 * input with these schemas and answers with them; TASK-0109 (seller console)
 * and TASK-0110 (admin review) build their mocking data from the same objects,
 * which is what gate C1 asks for and what makes C2·C3 check the same contract
 * from both sides.
 *
 * **Applying and editing the store are one surface on purpose.** The brand
 * name, the introduction and the logo are the same four fields whether they
 * arrive with an application or with a later edit (TASK-0027's store settings
 * were merged into this task), so they are described once here rather than
 * twice in two request schemas that would drift apart on the first change.
 */

/**
 * Where a store is in its onboarding (`docs/design/state-machines.md` 6).
 *
 * Mirrors the Prisma `SellerStatus` enum. It lives here rather than being
 * imported from the generated client because all three front-ends need it and
 * must not depend on the API's database layer — the same argument
 * `auth/roles.ts` makes for `Role`.
 */
export const sellerStatuses = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'] as const

export type SellerStatus = (typeof sellerStatuses)[number]

export const sellerStatusSchema = z.enum(sellerStatuses)

export const sellerIdSchema = z.uuid()

export const SELLER_BRAND_NAME_MIN_LENGTH = 2

export const SELLER_BRAND_NAME_MAX_LENGTH = 40

/**
 * The store's display name. Unique across the platform.
 *
 * **Not `.trim()`ed — surrounding whitespace is refused.** Trimming would make
 * `"  루미에르 "` and `"루미에르"` the same request while looking like two
 * different ones in the console's field, and the person who typed the first
 * would never learn that the name they see is not the name that was stored.
 * The uniqueness half is the database's answer (`Seller_brandName_key`), never
 * this schema's: a check here would be a read that another request can
 * invalidate between the check and the insert.
 */
export const sellerBrandNameSchema = z
  .string()
  .min(SELLER_BRAND_NAME_MIN_LENGTH)
  .max(SELLER_BRAND_NAME_MAX_LENGTH)
  .refine((value) => value === value.trim(), {
    error: '브랜드명 앞뒤에 공백을 쓸 수 없어요.',
  })

/**
 * The storefront's URL identifier, separate from the brand name.
 *
 * The separation is the schema's (`Seller.slug`) and the reason is R4: renaming
 * a brand must not break every link that points at the store. The shape is the
 * one `categorySlugSchema` uses, for the same reason — a slug carrying an
 * uppercase letter or a space works in a query string and fails in a path
 * segment.
 */
export const sellerSlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const SELLER_INTRODUCTION_MAX_LENGTH = 2_000

export const sellerIntroductionSchema = z.string().trim().max(SELLER_INTRODUCTION_MAX_LENGTH)

/**
 * Where the logo already lives. **This API never uploads anything** — the
 * presigned upload is TASK-0011's endpoint and the widget that drives it is
 * TASK-0033, so what arrives here is the resulting URL as a string.
 */
export const sellerLogoUrlSchema = z.string().trim().min(1).max(2_048)

export const SELLER_STATUS_REASON_MAX_LENGTH = 500

/**
 * Why a store was rejected or suspended, in the operator's words.
 *
 * Shown back to the seller (`Seller.statusReason`), so it is a sentence a
 * person wrote rather than a code: the reasons an operator gives are open-ended
 * and enumerating them would either be wrong or grow forever.
 */
export const sellerStatusReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(SELLER_STATUS_REASON_MAX_LENGTH)

/**
 * One store, as every endpoint in this task answers with it.
 *
 * `userId` and `createdAt` are here beyond the nine fields TASK-0108 4장 listed,
 * and both are for the review queue: a list of applications that cannot say
 * **who** applied and **when** is not a queue anybody can work, and TASK-0110
 * would otherwise have to fetch an account per row to render one screen. Adding
 * them here rather than there keeps the contract in one place (9장, 2026-09-04).
 */
export const sellerSchema = z.object({
  id: sellerIdSchema,
  /** The account that owns the store. One store per account (`Seller_userId_key`). */
  userId: z.uuid(),
  brandName: z.string(),
  slug: z.string(),
  introduction: z.string().nullable(),
  logoUrl: z.string().nullable(),
  status: sellerStatusSchema,
  /** The reason behind the current status; `null` while none was given. */
  statusReason: z.string().nullable(),
  /** When the status last moved; `null` for a store nobody has decided on yet. */
  statusChangedAt: z.iso.datetime().nullable(),
  /** Optimistic lock (DECISIONS 4). Every write that changes the row raises it. */
  version: z.int().min(0),
  createdAt: z.iso.datetime(),
})

export type Seller = z.infer<typeof sellerSchema>

/**
 * The envelope one store comes back in.
 *
 * `{ seller }` rather than the bare object, exactly like `productResponseSchema`
 * — a response that is a naked entity has nowhere to grow a sibling field
 * without breaking every reader.
 */
export const sellerResponseSchema = z.object({ seller: sellerSchema })

export type SellerResponse = z.infer<typeof sellerResponseSchema>

/**
 * Body of `POST /api/v1/sellers/applications` — applying, and re-applying after
 * a rejection.
 *
 * Both cases send the whole form: a re-application is a new submission of the
 * same four fields, not a patch on a rejected one, and treating it as a patch
 * would leave a store whose brand name was the reason for the rejection unable
 * to say so.
 */
export const sellerApplicationRequestSchema = z.object({
  brandName: sellerBrandNameSchema,
  slug: sellerSlugSchema,
  introduction: sellerIntroductionSchema.optional(),
  logoUrl: sellerLogoUrlSchema.optional(),
})

export type SellerApplicationRequest = z.infer<typeof sellerApplicationRequestSchema>

/**
 * Body of `PATCH /api/v1/sellers/me` — the store settings a seller edits.
 *
 * **No `slug`.** The URL identifier is deliberately out of scope (R4): changing
 * it breaks every link that points at the store, and there is no redirect table
 * to catch them. Everything else is optional, so a request states only what it
 * changes; `version` is not, because a save that does not say which version it
 * was written against cannot be refused when somebody else saved first.
 */
export const sellerStoreUpdateRequestSchema = z.object({
  brandName: sellerBrandNameSchema.optional(),
  introduction: sellerIntroductionSchema.nullable().optional(),
  logoUrl: sellerLogoUrlSchema.nullable().optional(),
  version: z.int().min(0),
})

export type SellerStoreUpdateRequest = z.infer<typeof sellerStoreUpdateRequestSchema>

/** Query of `GET /api/v1/sellers/brand-name-availability`. */
export const brandNameAvailabilityQuerySchema = z.object({ value: sellerBrandNameSchema })

export type BrandNameAvailabilityQuery = z.infer<typeof brandNameAvailabilityQuerySchema>

/**
 * Whether a brand name is free **at the moment of asking**.
 *
 * A convenience for a form, never a decision: two applications can both be told
 * `available: true` and only one of them can be stored, because the answer is a
 * read and the constraint is `Seller_brandName_key`. The API refuses the loser
 * with a 409 naming `brandName` (F6), and that refusal — not this endpoint — is
 * what makes duplicates impossible.
 */
export const brandNameAvailabilityResponseSchema = z.object({
  value: z.string(),
  available: z.boolean(),
})

export type BrandNameAvailabilityResponse = z.infer<typeof brandNameAvailabilityResponseSchema>

export const SELLER_REVIEW_LIST_MAX_LIMIT = 100

export const SELLER_REVIEW_LIST_DEFAULT_LIMIT = 20

/** Query of `GET /api/v1/admin/sellers` — the review queue, as a caller writes it. */
export const sellerReviewListQuerySchema = z.object({
  /** Omitted means every status, which is what "전체" in the console sends. */
  status: sellerStatusSchema.optional(),
  limit: z.int().min(1).max(SELLER_REVIEW_LIST_MAX_LIMIT).optional(),
  /** Reads the applications **older** than this id. */
  cursor: sellerIdSchema.optional(),
})

export type SellerReviewListQuery = z.infer<typeof sellerReviewListQuerySchema>

/**
 * The same query as it arrives on the wire, where every value is a string.
 *
 * Kept beside the typed form instead of in the controller so that the two
 * cannot drift: adding a parameter to one without the other stops compiling.
 */
export const sellerReviewListQueryParamsSchema = z.object({
  status: sellerStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(SELLER_REVIEW_LIST_MAX_LIMIT).optional(),
  cursor: sellerIdSchema.optional(),
})

/**
 * A page of applications, newest first.
 *
 * `nextCursor` is the id to pass back, or `null` at the end. Store ids are
 * UUIDv7 and therefore already in creation order, so "newest first" is
 * `ORDER BY id DESC` and the cursor needs nothing but the last id — no
 * `(createdAt, id)` pair to keep consistent, and no offset that shifts under an
 * application submitted while the operator is reading page two.
 */
export const sellerReviewListResponseSchema = z.object({
  sellers: z.array(sellerSchema),
  nextCursor: sellerIdSchema.nullable(),
})

export type SellerReviewListResponse = z.infer<typeof sellerReviewListResponseSchema>

/**
 * Body of the four review endpoints.
 *
 * `version` is required for the same reason it is on a store edit, and here it
 * does one more job: two operators clicking 승인 on the same application send
 * the same version, so exactly one of them can win (F13). Without it the second
 * click would be a second transition of a row that had already moved.
 *
 * `reason` is optional **on this schema** and required by
 * {@link sellerReasonedDecisionRequestSchema} for 반려 and 정지 — the two
 * decisions the seller has to be able to act on. Approving and reinstating may
 * carry a note and usually do not.
 */
export const sellerDecisionRequestSchema = z.object({
  reason: sellerStatusReasonSchema.optional(),
  version: z.int().min(0),
})

export type SellerDecisionRequest = z.infer<typeof sellerDecisionRequestSchema>

/**
 * The body 반려 and 정지 take: the same decision, with the reason made
 * mandatory.
 *
 * Stated as a schema rather than as a check inside the service so that the
 * refusal is the ordinary 400 with `details[].field = 'reason'` that every form
 * already knows how to render, and so a console can require the field from the
 * same object it validates the rest of the body with.
 */
export const sellerReasonedDecisionRequestSchema = sellerDecisionRequestSchema.extend({
  reason: sellerStatusReasonSchema,
})

export type SellerReasonedDecisionRequest = z.infer<typeof sellerReasonedDecisionRequestSchema>
