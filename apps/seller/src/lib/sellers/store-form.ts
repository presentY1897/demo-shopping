import type { Seller, SellerApplicationRequest, SellerStoreUpdateRequest } from '@shopping/shared'
import { sellerApplicationRequestSchema, sellerStoreUpdateRequestSchema } from '@shopping/shared'
import { z } from 'zod'

/**
 * The four inputs, and the two requests they turn into (TASK-0109 4장).
 *
 * **One form component, two schemas.** Applying sends the whole form and needs a
 * `slug`; saving sends what changed and needs a `version` and no `slug` at all
 * (TASK-0108 R4 — a store's URL must survive a rename). Building both here means
 * the *component* never branches on which one it is: it renders four controls
 * and hands the values to whichever schema the caller chose.
 *
 * **The rules come from `@shopping/shared`; only the wording is this app's.**
 * `sellerApplicationRequestSchema` and `sellerStoreUpdateRequestSchema` are the
 * objects `apps/api` validates the same request with (`SellerController`), so a
 * length or a slug pattern is stated once. What they carry is zod's default
 * English — "Too small: expected string to have >=2 characters" — which is not
 * something to show a seller, and which is not the contract's to fix: the copy
 * belongs to the app that renders it (`packages/ui/form/field-errors.ts` states
 * the same rule for the same reason). So the schema below runs the shared one
 * and re-words what it says, keeping the path so the message still lands on the
 * input it is about.
 */

/** Field paths this form can place a message on, for `serverFieldErrors`. */
export const STORE_FORM_FIELDS = ['brandName', 'slug', 'introduction', 'logoUrl'] as const

/**
 * What the controls hold. Strings throughout — a text input has nothing else.
 *
 * Derived from {@link STORE_FORM_FIELDS} rather than written out beside it: the
 * same list is what `serverFieldErrors` places messages onto, and two lists
 * would let a field exist in one and not the other. A mapped type rather than an
 * interface, so TypeScript gives it the implicit index signature `useForm`'s
 * `FormValues` asks for.
 */
export type StoreFormField = (typeof STORE_FORM_FIELDS)[number]

export type StoreFormValues = Readonly<Record<StoreFormField, string>>

/**
 * What a valid submit produced, and which endpoint it is for.
 *
 * Tagged rather than left as two bare request types: the form component holds
 * **one** `useForm`, so both schemas have to unify to a single output type, and
 * a union of two anonymous objects would be told apart by whichever key happened
 * to be present. The tag is decided by the schema that built it, which is the
 * same thing that decided the rules.
 */
export type StoreSubmission =
  | { readonly kind: 'apply'; readonly request: SellerApplicationRequest }
  | { readonly kind: 'save'; readonly request: SellerStoreUpdateRequest }

/** The form as it starts: the stored store, or blank for a first application. */
export function storeFormValues(seller: Seller | null): StoreFormValues {
  return {
    brandName: seller?.brandName ?? '',
    slug: seller?.slug ?? '',
    introduction: seller?.introduction ?? '',
    logoUrl: seller?.logoUrl ?? '',
  }
}

/** One sentence per way an input can be wrong. Korean lives in the catalog. */
export interface StoreFieldErrorMessages {
  readonly brandNameRequired: string
  readonly brandNameLength: string
  readonly brandNameWhitespace: string
  /** The availability check already said somebody holds it. */
  readonly brandNameTaken: string
  readonly slugRequired: string
  readonly slugFormat: string
  readonly introductionTooLong: string
  readonly logoUrlTooLong: string
}

export interface StoreSchemaOptions {
  readonly messages: StoreFieldErrorMessages
}

function text(values: Record<string, unknown>, key: string): string {
  const value = values[key]

  return typeof value === 'string' ? value : ''
}

function isBlank(value: string): boolean {
  return value.trim() === ''
}

/** The sentence for one issue, or the schema's own when nothing fits. */
function sentenceFor(
  messages: StoreFieldErrorMessages,
  field: string,
  code: string,
  blank: boolean,
  fallback: string,
): string {
  if (field === 'brandName') {
    if (code === 'invalid_type' || blank) return messages.brandNameRequired
    if (code === 'too_small' || code === 'too_big') return messages.brandNameLength
    if (code === 'custom') return messages.brandNameWhitespace
  }
  if (field === 'slug') return blank ? messages.slugRequired : messages.slugFormat
  if (field === 'introduction' && code === 'too_big') return messages.introductionTooLong
  if (field === 'logoUrl' && code === 'too_big') return messages.logoUrlTooLong

  return fallback
}

/**
 * Runs `contract` over the form's values and re-words what it refuses.
 *
 * `z.unknown().transform` rather than rebuilding the object with Korean
 * messages: rebuilding would restate every rule — the two lengths, the slug
 * pattern, the no-surrounding-whitespace refinement — in a second place, and the
 * copy would keep matching a rule that had moved. This way the shared schema
 * stays the only statement of what is allowed, and its `path` is what puts the
 * sentence under the right control.
 */
function localised<T extends StoreSubmission>(
  contract: z.ZodType<T['request']>,
  wrap: (request: T['request']) => T,
  prepare: (values: Record<string, unknown>) => Record<string, unknown>,
  { messages }: StoreSchemaOptions,
): z.ZodType<StoreSubmission> {
  return z.unknown().transform((input, ctx) => {
    const values: Record<string, unknown> =
      typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
    const parsed = contract.safeParse(prepare(values))

    for (const issue of parsed.success ? [] : parsed.error.issues) {
      const field = issue.path.map((segment) => String(segment)).join('.')

      ctx.addIssue({
        code: 'custom',
        path: issue.path,
        message: sentenceFor(
          messages,
          field,
          issue.code,
          isBlank(text(values, field)),
          issue.message,
        ),
        input,
      })
    }

    if (!parsed.success) return z.NEVER

    return wrap(parsed.data)
  })
}

/** `''` is "not filled in", which the application contract spells `undefined`. */
function forApplication(values: Record<string, unknown>): Record<string, unknown> {
  const introduction = text(values, 'introduction')
  const logoUrl = text(values, 'logoUrl')

  return {
    brandName: values.brandName,
    slug: values.slug,
    ...(isBlank(introduction) ? {} : { introduction }),
    ...(isBlank(logoUrl) ? {} : { logoUrl }),
  }
}

/**
 * `POST /sellers/applications` — 신청 and 재신청.
 *
 * Both send the whole form. A re-application is a new submission rather than a
 * patch on the rejected row, because the brand name may well have been the
 * reason for the rejection (TASK-0108 `SellerService.apply`).
 */
export function applicationFormSchema(options: StoreSchemaOptions): z.ZodType<StoreSubmission> {
  return localised<{ kind: 'apply'; request: SellerApplicationRequest }>(
    sellerApplicationRequestSchema,
    (request) => ({ kind: 'apply', request }),
    forApplication,
    options,
  )
}

/**
 * `PATCH /sellers/me` — the store's copy, in every status.
 *
 * **A cleared optional field is `null`, not a missing key.** The contract makes
 * `introduction` and `logoUrl` nullable precisely so that "I want no
 * introduction" is expressible; sending nothing would mean "leave it as it was",
 * and somebody deleting a paragraph would watch it come back.
 *
 * `brandName` is the opposite and is **not** blanked: it is required on the row,
 * so an empty one is a mistake to report rather than a change to send. The
 * contract's `.optional()` is for a request that does not touch the name at all.
 *
 * `slug` is absent from the contract, and `z.object` strips it — the form still
 * shows it, read-only, because a seller has to be able to see their own address.
 */
export function storeUpdateFormSchema(
  version: number,
  options: StoreSchemaOptions,
): z.ZodType<StoreSubmission> {
  return localised<{ kind: 'save'; request: SellerStoreUpdateRequest }>(
    sellerStoreUpdateRequestSchema,
    (request) => ({ kind: 'save', request }),
    (values) => ({
      brandName: values.brandName,
      introduction: isBlank(text(values, 'introduction')) ? null : text(values, 'introduction'),
      logoUrl: isBlank(text(values, 'logoUrl')) ? null : text(values, 'logoUrl'),
      version,
    }),
    options,
  )
}
