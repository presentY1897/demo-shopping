/**
 * The plan, checked as a constant.
 *
 * QUALITY-GATES Q5 puts this file in the 순수 로직 row for the reason TASK-0025
 * R1 gives: a mistake here does not fail, it **deletes**. So the properties are
 * asserted rather than reviewed — every step names an owner, the order respects
 * the foreign keys, and no table in the schema is left unclassified (F8).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'
import type { CleanupStep } from './demo-cleanup-plan.js'
import { cleanupPlan, orderFault, ownedTables, untouchedTables } from './demo-cleanup-plan.js'

/** Every `model X` in the schema — the single source of what exists. */
function schemaModels(): readonly string[] {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')

  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(([, name]) => name ?? '')
}

describe('every step names an owner (R1)', () => {
  it('never sweeps a table without saying whose rows they are', () => {
    // The failure this prevents is a `deleteMany({})`. A step whose scope is
    // missing is a step that would take every row in the table.
    for (const step of cleanupPlan) {
      expect(step.scope, step.table).toBeDefined()
      expect(['user', 'seller', 'product', 'self']).toContain(step.scope)
    }
  })

  it('explains every row it cannot simply delete', () => {
    // A soft delete without a reason is a soft delete somebody will "simplify"
    // into a hard one, and it will fail in production against a RESTRICT.
    for (const step of cleanupPlan.filter((entry) => entry.kind !== 'hard')) {
      expect(step.because, step.table).toBeTruthy()
    }
  })

  it('covers each table once', () => {
    const tables = cleanupPlan.map((step) => step.table)

    expect(new Set(tables).size).toBe(tables.length)
    expect([...tables].sort()).toEqual([...ownedTables].sort())
  })
})

describe('the order is the foreign keys', () => {
  it('removes children before parents', () => {
    expect(orderFault()).toBeNull()
  })

  it('catches an order that would fail against a constraint', () => {
    // The negative control: if `orderFault` answered `null` for everything, the
    // check above would be decoration.
    const broken: readonly CleanupStep[] = [
      { table: 'Seller', kind: 'suspend', scope: 'user', because: '' },
      { table: 'Product', kind: 'soft', scope: 'seller', because: '' },
    ]

    expect(orderFault(broken)).toEqual({ before: 'Seller', after: 'Product' })
  })
})

describe('F8 — nothing in the schema is left unclassified', () => {
  it('classifies every model as swept or deliberately untouched', () => {
    // The retrieval mechanism the task promises. When M07 adds `Order`, this
    // fails until somebody decides whether it is swept or kept — which is the
    // decision that would otherwise be forgotten until a demo account left an
    // order behind.
    const classified = new Set<string>([
      ...cleanupPlan.map((step) => step.table),
      ...Object.keys(untouchedTables),
    ])
    const unclassified = schemaModels().filter((model) => !classified.has(model))

    expect(unclassified).toEqual([])
  })

  it('classifies nothing that is not in the schema', () => {
    // The other direction: a table renamed out from under the plan would leave a
    // step that sweeps nothing, and the account would keep its rows.
    const models = new Set(schemaModels())
    const ghosts = [
      ...cleanupPlan.map((step) => step.table),
      ...Object.keys(untouchedTables),
    ].filter((table) => !models.has(table))

    expect(ghosts).toEqual([])
  })

  it('says why each untouched table is left alone', () => {
    for (const [table, reason] of Object.entries(untouchedTables)) {
      expect(reason, table).toBeTruthy()
    }
  })
})
