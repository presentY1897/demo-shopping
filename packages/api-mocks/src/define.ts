import type { z } from 'zod'

/**
 * Marks a value as having been through {@link defineFixture}, and remembers
 * which schema it was checked against.
 *
 * `Symbol.for` rather than a module level `Symbol()`: the package is loaded by
 * three app test runners and by its own, and a per-instance symbol would make
 * the brand invisible across realms. Non-enumerable and symbol keyed, so
 * `JSON.stringify` — which is how msw turns a fixture into a response body —
 * never sees it.
 */
const FIXTURE_SCHEMA = Symbol.for('@shopping/api-mocks/fixture-schema')

/**
 * The one way to create mock response data (QUALITY-GATES C2).
 *
 * Parsing happens at module load, so a fixture that drifts from the contract
 * takes down every spec that imports it — including the app specs, which never
 * mention the schema themselves. Types alone would not do: `uptime: -1` and
 * `version: ''` both typecheck and both fail `healthResponseSchema`.
 *
 * The returned value is frozen. A spec that mutated a shared fixture would put
 * unparsed data back into circulation, which is the hole this function exists
 * to close.
 */
export function defineFixture<TSchema extends z.ZodType<object>>(
  schema: TSchema,
  value: z.input<TSchema>,
): z.output<TSchema> {
  const parsed: object = schema.parse(value)

  Object.defineProperty(parsed, FIXTURE_SCHEMA, {
    configurable: false,
    enumerable: false,
    value: schema,
    writable: false,
  })

  return Object.freeze(parsed) as z.output<TSchema>
}

/** True only for values produced by {@link defineFixture}. */
export function isFixture(value: unknown): boolean {
  return typeof value === 'object' && value !== null && FIXTURE_SCHEMA in value
}

/**
 * The schema a fixture was validated against, or `null` for anything that did
 * not come from {@link defineFixture}. The registry spec re-parses through this
 * rather than keeping a second, hand maintained schema list that could go stale.
 */
export function fixtureSchemaOf(value: unknown): z.ZodType<object> | null {
  if (!isFixture(value)) return null

  return (value as Record<symbol, z.ZodType<object>>)[FIXTURE_SCHEMA] ?? null
}
