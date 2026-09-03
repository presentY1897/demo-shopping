/**
 * TASK-0016 F4c — the card responds to **its own width**, not the window's.
 *
 * This is the one claim in the whole TASK that is easiest to make and hardest to
 * keep. `md:flex-row` and `@md/card:flex-row` differ by five characters, they
 * look the same in a screenshot of a full-width card, and they behave
 * identically until the day the same card is rendered in a six-column grid. At
 * that point the media-query version lays a 200px card out as if it were 1400px
 * wide, because the viewport it is asking about is still 1400px.
 *
 * A browser measurement would catch it once. This catches it on every commit:
 * the classes are read off the *rendered* card and compiled with the real
 * Tailwind, so what is asserted is the at-rule the browser will evaluate.
 */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Card } from '../src/components/card'
import { TableToCards } from '../src/components/table-to-cards'
import type { TableColumn } from '../src/components/table'
import { classNamesIn, compileClasses, declarationFor, rulesForClass } from './support/tailwind'

/** Rules that only apply under some condition — the responsive ones. */
function conditionalRules(rules: readonly { readonly conditions: readonly string[] }[]) {
  return rules.filter((rule) => rule.conditions.length > 0)
}

function isContainerCondition(condition: string): boolean {
  return condition.startsWith('@container')
}

async function compileRendered(ui: React.ReactElement) {
  const { container } = render(ui)
  const classes = classNamesIn(container)
  return { classes, rules: await compileClasses(classes) }
}

const CARD = (
  <Card actions={<button type="button">Buy</button>} media={<span>image</span>}>
    <p>Wool coat</p>
  </Card>
)

describe('the container-query check itself', () => {
  it('can tell a container query from a media query', () => {
    // Without this, an assertion that "no rule is a media query" would also pass
    // for a card whose classes compile to nothing at all.
    expect(isContainerCondition('@container card (width >= 28rem)')).toBe(true)
    expect(isContainerCondition('@media (width >= 48rem)')).toBe(false)
  })

  it('sees a media query when one is genuinely there', async () => {
    const rules = await compileClasses(['md:flex-row'])
    const conditions = rulesForClass(rules, 'md:flex-row').flatMap((rule) => rule.conditions)

    expect(conditions).toEqual(['@media (width >= 48rem)'])
  })
})

describe('Card', () => {
  it('declares itself a container', async () => {
    const { rules } = await compileRendered(CARD)

    // Without `container-type`, every `@md/card:` rule below resolves against
    // some ancestor container or against nothing, and the card silently renders
    // its narrow form forever.
    expect(declarationFor(rules, '@container/card', 'container-type')).toBe('inline-size')
    expect(declarationFor(rules, '@container/card', 'container-name')).toBe('card')
  })

  it('switches layout on the container, never on the viewport', async () => {
    const { classes, rules } = await compileRendered(CARD)

    const conditions = conditionalRules(
      rules.filter((rule) =>
        classes.some((className) => rulesForClass([rule], className).length > 0),
      ),
    ).flatMap((rule) => rule.conditions)

    expect(conditions.length).toBeGreaterThan(0)
    expect(conditions.filter((condition) => !isContainerCondition(condition))).toEqual([])
  })

  it('compiles its direction switch to a container rule against its own name', async () => {
    const { rules } = await compileRendered(CARD)
    const [rule] = rulesForClass(rules, '@md/card:flex-row')

    expect(rule?.declarations['flex-direction']).toBe('row')
    expect(rule?.conditions).toEqual(['@container card (width >= 28rem)'])
  })
})

describe('TableToCards', () => {
  it('lays its label/value pairs out on the card width', async () => {
    const columns: readonly TableColumn<{ readonly id: string }>[] = [
      { cell: (row) => row.id, header: 'Order', key: 'id' },
      { cell: () => 'Preparing', header: 'Status', key: 'status' },
      { cell: () => 'Han', header: 'Buyer', key: 'buyer' },
    ]

    const { classes, rules } = await compileRendered(
      <TableToCards
        caption="Orders"
        columns={columns}
        rowKey={(row) => row.id}
        rows={[{ id: '20260903-0001' }]}
      />,
    )

    // The seller order list is the screen this exists for, and it is the one
    // that gets read on a phone in one column and on a laptop in two.
    expect(classes).toContain('@sm/card:grid-cols-2')

    const conditions = rulesForClass(rules, '@sm/card:grid-cols-2').flatMap(
      (rule) => rule.conditions,
    )
    expect(conditions).toHaveLength(1)
    expect(conditions.every(isContainerCondition)).toBe(true)
  })
})
