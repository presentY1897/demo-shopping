/**
 * C2 — every mock response the front-end can receive passes the schema the
 * back-end answers against (QUALITY-GATES 5장).
 *
 * Two checks, because either alone leaves a way through. Parsing the registry
 * catches a fixture that drifted; sweeping `src/fixtures` off disk catches a
 * fixture that was written as a plain object literal, or put in a file the
 * barrel never re-exports, and so was never in the registry to begin with.
 */

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isFixture } from './define'
import * as barrel from './fixtures'
import { fixtureRegistry } from './registry'

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const FIXTURE_FILES = readdirSync(FIXTURES_DIR).filter(
  (file) => file.endsWith('.ts') && file !== 'index.ts' && !file.endsWith('.spec.ts'),
)

describe('the fixture registry', () => {
  it('is not empty', () => {
    // A registry that found nothing would make every check below vacuous.
    expect(fixtureRegistry.length).toBeGreaterThan(0)
  })

  it('has a schema for every entry', () => {
    const unbranded = fixtureRegistry.filter((entry) => entry.schema === null)

    expect(unbranded.map((entry) => entry.name)).toEqual([])
  })

  it.each(fixtureRegistry.map((entry) => [entry.name, entry] as const))(
    '%s parses against its schema',
    (_name, entry) => {
      expect(entry.schema?.safeParse(entry.value).success).toBe(true)
    },
  )
})

describe('src/fixtures on disk', () => {
  it('has files to sweep', () => {
    expect(FIXTURE_FILES.length).toBeGreaterThan(0)
  })

  it.each(FIXTURE_FILES)(
    '%s exports only fixtures, and all of them reach the barrel',
    async (file) => {
      const module = (await import(join(FIXTURES_DIR, file))) as Record<string, unknown>
      const exported = Object.entries(module)

      expect(exported.length).toBeGreaterThan(0)

      for (const [name, value] of exported) {
        // A plain object literal here would be mock data nothing ever parses.
        expect(isFixture(value), `${file} exports "${name}" without defineFixture`).toBe(true)
        // And a fixture the barrel misses never reaches the registry above.
        expect(Object.hasOwn(barrel, name), `${file}'s "${name}" is not re-exported`).toBe(true)
      }
    },
  )
})
