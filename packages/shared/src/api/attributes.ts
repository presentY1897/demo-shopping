import { z } from 'zod'

import { categoryIdSchema } from './categories.js'

/**
 * Attribute definitions, as the API states them (TASK-0030).
 *
 * This is the contract half of "카테고리·속성은 코드 수정 없이 추가·설정 가능"
 * (DECISIONS 1). A definition is a row; the **values** it describes live in
 * `Product.attributes` as JSONB, so the storefront reads twenty products without
 * a join and the database, in exchange, cannot check a single value
 * (`docs/design/erd.md` 2).
 *
 * Contract gate C1: these schemas are the only definition of an attribute
 * request or response in the repository. `apps/api` validates its input with
 * them and the front-ends parse their answers with them, so a renamed field
 * cannot be green on one side and broken on the other. C3 then holds
 * structurally, because `createApiClient` parses every response with the very
 * schema declared here.
 */

/**
 * The five kinds of value an attribute can hold.
 *
 * Closed on purpose, and small on purpose. Each one has to be expressible twice
 * — as a zod schema built at runtime from a definition (the only thing standing
 * between a typo and an unreadable `attributes` object) and as a Meilisearch
 * filter later (M06). A type that cannot be filtered is a facet the storefront
 * can never offer, so it does not belong here.
 */
export const attributeTypes = ['TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN'] as const

export type AttributeType = (typeof attributeTypes)[number]

export const attributeTypeSchema = z.enum(attributeTypes)

/** The two types whose meaning depends on a list of choices. */
export const attributeTypesWithOptions: readonly AttributeType[] = ['SELECT', 'MULTI_SELECT']

export function attributeTypeHasOptions(type: AttributeType): boolean {
  return attributeTypesWithOptions.includes(type)
}

/**
 * Identifier of the value inside `Product.attributes`.
 *
 * Lowercase, starting with a letter, `_` as the only separator, at most 40
 * characters — the same expression the database holds as
 * `AttributeDefinition_key_format_check`. The rule is strict because the string
 * is an identifier in two systems at once: a JSON object key and a Meilisearch
 * filter field name. `size.eu` would read as a path expression on the search
 * side and quietly match nothing, which is a failure that raises no error
 * anywhere.
 */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

export const attributeKeySchema = z.string().regex(ATTRIBUTE_KEY_PATTERN)

/** What a person reads next to the field. Operator-entered, so Korean is data. */
export const attributeLabelSchema = z.string().trim().min(1).max(40)

/** One choice of a `SELECT` or `MULTI_SELECT`. */
export const attributeOptionSchema = z.string().trim().min(1).max(40)

/**
 * The choices of one definition.
 *
 * Capped at 100 because these are rendered as a list a person picks from; a
 * definition with a thousand choices is a lookup table wearing an attribute's
 * clothes, and the form for it would be unusable.
 */
export const ATTRIBUTE_MAX_OPTIONS = 100

export const attributeOptionsSchema = z.array(attributeOptionSchema).max(ATTRIBUTE_MAX_OPTIONS)

/** Longest `TEXT` value a product may carry. */
export const ATTRIBUTE_TEXT_MAX_LENGTH = 200

/**
 * The value of one attribute on a product.
 *
 * A closed union rather than `unknown`: `Product.attributes` is JSONB, so
 * anything at all would survive the round trip, and "whatever was sent" is
 * precisely the state this task exists to prevent. Nested objects are absent by
 * design — an attribute whose value has structure is two attributes.
 */
export const attributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
])

export type AttributeValue = z.infer<typeof attributeValueSchema>

/** Every attribute value of one product, keyed by definition key. */
export const attributeValuesSchema = z.record(z.string(), attributeValueSchema)

export type AttributeValues = z.infer<typeof attributeValuesSchema>

export const attributeIdSchema = z.int().positive()

/** One definition, as it is stored. */
export const attributeDefinitionSchema = z.object({
  id: attributeIdSchema,
  /** The category the definition is attached to — not necessarily the one asked about. */
  categoryId: categoryIdSchema,
  key: z.string(),
  label: z.string(),
  type: attributeTypeSchema,
  /** Empty for every type but `SELECT` and `MULTI_SELECT`. */
  options: z.array(z.string()),
  isRequired: z.boolean(),
  /** Whether the attribute becomes a search facet (M06). */
  isFilterable: z.boolean(),
  sortOrder: z.int().min(0),
  /** Optimistic lock; send it back in an update (DECISIONS 4). */
  version: z.int().min(0),
})

export type AttributeDefinition = z.infer<typeof attributeDefinitionSchema>

/**
 * A definition as it applies to one category, inherited ones included.
 *
 * `inherited` is derived rather than stored — it says whether `categoryId` is
 * the category that was asked about or one of its ancestors. A console needs it
 * to know which rows it may edit here and which belong further up the tree.
 */
export const effectiveAttributeSchema = attributeDefinitionSchema.extend({
  inherited: z.boolean(),
})

export type EffectiveAttribute = z.infer<typeof effectiveAttributeSchema>

/**
 * The effective set for one category, general first.
 *
 * Ordered by the depth of the category that owns each definition, then by
 * `sortOrder`: a form built from this list reads from the general (브랜드, on a
 * root) to the specific (소재, on the leaf) without the caller sorting anything.
 */
export const attributeListResponseSchema = z.object({
  attributes: z.array(effectiveAttributeSchema),
})

export type AttributeListResponse = z.infer<typeof attributeListResponseSchema>

/** What a single-definition mutation answers with. */
export const attributeResponseSchema = z.object({ attribute: attributeDefinitionSchema })

export type AttributeResponse = z.infer<typeof attributeResponseSchema>

/** Query of `GET /api/v1/attributes`, as a caller writes it. */
export const attributeListQuerySchema = z.object({
  /** Required: attributes only mean anything relative to a category. */
  categoryId: categoryIdSchema,
  /**
   * Ancestors' definitions are part of the answer by default — that is what
   * inheritance means. `false` narrows it to the ones this category owns, which
   * is what an editing screen needs (TASK-0031).
   */
  includeInherited: z.boolean().optional(),
})

export type AttributeListQuery = z.infer<typeof attributeListQuerySchema>

/**
 * The same query as it arrives on the wire, where every value is a string.
 *
 * Kept beside the typed form instead of in the controller so that the two cannot
 * drift: adding a parameter to one without the other stops compiling.
 */
export const attributeListQueryParamsSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  includeInherited: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

/** One issue, in the shape `.check` wants, without the `input` it cannot know. */
interface OptionIssue {
  readonly code: 'custom'
  readonly message: string
  readonly path: ['options']
}

/**
 * Whether `options` agrees with `type`.
 *
 * Exported so that the update request — which carries no `type` and has to read
 * it from the stored row — can ask the same question the create request asks,
 * rather than a second version of it that drifts.
 */
export function optionIssues(
  type: AttributeType,
  options: readonly string[] | undefined,
): readonly OptionIssue[] {
  const given = options ?? []
  const issues: OptionIssue[] = []

  if (attributeTypeHasOptions(type)) {
    if (given.length === 0) {
      issues.push({
        code: 'custom',
        message: `${type} 속성은 선택지가 최소 1개 필요합니다.`,
        path: ['options'],
      })
    }
  } else if (given.length > 0) {
    issues.push({
      code: 'custom',
      message: `${type} 속성은 선택지를 가질 수 없습니다.`,
      path: ['options'],
    })
  }

  if (new Set(given).size !== given.length) {
    issues.push({ code: 'custom', message: '선택지는 중복될 수 없습니다.', path: ['options'] })
  }

  return issues
}

/**
 * Creating a definition.
 *
 * `options` is checked against `type` here rather than only in the database,
 * so the caller gets a message naming the problem instead of a constraint name.
 * Both directions are refused: a `SELECT` without choices can never validate any
 * value — a required one makes every product in that category unsaveable — and
 * choices on a `BOOLEAN` are a definition whose author meant something else.
 */
export const createAttributeRequestSchema = z
  .object({
    categoryId: categoryIdSchema,
    key: attributeKeySchema,
    label: attributeLabelSchema,
    type: attributeTypeSchema,
    /** Omitted is the same as none, for the types that take none. */
    options: attributeOptionsSchema.optional(),
    isRequired: z.boolean().optional(),
    isFilterable: z.boolean().optional(),
    /** Appended after the category's last definition when omitted. */
    sortOrder: z.int().min(0).optional(),
  })
  .check((ctx) => {
    for (const issue of optionIssues(ctx.value.type, ctx.value.options)) {
      ctx.issues.push({ ...issue, input: ctx.value })
    }
  })

export type CreateAttributeRequest = z.infer<typeof createAttributeRequestSchema>

/**
 * Editing a definition.
 *
 * `key` and `type` are absent on purpose, and this is the one place the omission
 * has to be defended: both of them change what an already stored
 * `Product.attributes` *means*. Renaming the key orphans every value that used
 * it; changing the type makes every value a violation of the definition that
 * describes it. Replacing a definition is therefore a delete and a create, which
 * leaves the old row — soft deleted — as the record of what the old values were.
 *
 * `version` is required, not optional: an update that may omit its lock is an
 * update that will omit it, and the conflict it was there to catch becomes a
 * silently discarded edit (DECISIONS 4).
 */
export const updateAttributeRequestSchema = z.object({
  version: z.int().min(0),
  label: attributeLabelSchema.optional(),
  /**
   * Replaces the whole list. Narrowing it is what a caller has to think about:
   * a value already stored under a removed choice stops validating, and the
   * product carrying it cannot be saved again until it is edited.
   */
  options: attributeOptionsSchema.optional(),
  isRequired: z.boolean().optional(),
  isFilterable: z.boolean().optional(),
  sortOrder: z.int().min(0).optional(),
})

export type UpdateAttributeRequest = z.infer<typeof updateAttributeRequestSchema>
