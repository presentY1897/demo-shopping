import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parse } from 'yaml'
import { beforeAll, describe, expect, it } from 'vitest'

import { findRepoRoot } from '../../src/config/workspace.js'

/**
 * Validates `render.yaml` against Render's own JSON Schema.
 *
 * The blueprint is the single source of truth for what gets deployed, and a typo
 * in it (`plan: fre`, an unknown field, a service without a name) is not caught
 * by anything else in this repository: nothing imports it, nothing type checks
 * it, and Render only complains at deploy time — after someone has already
 * clicked through the dashboard.
 *
 * The schema is vendored rather than fetched. A test that reaches the network
 * either fails when Render is unreachable or, worse, gets written to skip
 * itself — and a check that skips is the state this suite exists to prevent.
 * Refresh it from https://render.com/schema/render.yaml.json when Render adds
 * fields we want to use.
 */
function repoFile(...segments: readonly string[]): string {
  const repoRoot = findRepoRoot()

  if (repoRoot === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')
  return readFileSync(join(repoRoot, ...segments), 'utf8')
}

/** Vendored copy; `import.meta` is unavailable in this package's CommonJS output. */
const SCHEMA_SEGMENTS = ['apps', 'api', 'test', 'ci', 'schemas', 'render.yaml.json'] as const

describe('render.yaml', () => {
  let validate: ReturnType<Ajv2020['compile']>
  let blueprint: unknown

  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })

    addFormats(ajv)
    validate = ajv.compile(JSON.parse(repoFile(...SCHEMA_SEGMENTS)) as object)
    blueprint = parse(repoFile('render.yaml'))
  })

  it("matches Render's blueprint schema", () => {
    const valid = validate(blueprint)

    // Errors first: a failure should name the offending field, not just say false.
    expect(validate.errors ?? []).toEqual([])
    expect(valid).toBe(true)
  })

  it('rejects a blueprint the schema should not accept', () => {
    // Without this the suite would pass just as happily against a schema that
    // accepts everything — which is what a wrong `$schema` or a failed compile
    // would leave behind.
    expect(validate({ services: [{ type: 'web', name: 'x', runtime: 'node', plan: 'fre' }] })).toBe(
      false,
    )
  })

  it('pins the search image to an exact tag', () => {
    // `latest` would make two deploys of the same commit differ.
    const raw = repoFile('render.yaml')

    expect(raw).toMatch(/getmeili\/meilisearch:v\d+\.\d+\.\d+/)
    expect(raw).not.toMatch(/meilisearch:latest/)
  })
})
