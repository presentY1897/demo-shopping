import { fixtureSchemaOf } from './define'
import * as fixtureModules from './fixtures'

export interface RegisteredFixture {
  readonly name: string
  readonly value: unknown
  /** `null` when the value never went through `defineFixture`. */
  readonly schema: ReturnType<typeof fixtureSchemaOf>
}

/**
 * Every fixture the package exports, paired with the schema it was checked
 * against (QUALITY-GATES C2).
 *
 * Derived from the barrel rather than hand listed. A hand written list is a
 * second place to forget, and "forgot to register it" is exactly the state where
 * a fixture drifts unnoticed. Because the schema is read back off the value's
 * brand, an entry with `schema: null` is a fixture that skipped `defineFixture`
 * — which `registry.spec.ts` fails on.
 */
export const fixtureRegistry: readonly RegisteredFixture[] = Object.entries(fixtureModules).map(
  ([name, value]) => ({ name, schema: fixtureSchemaOf(value), value }),
)
