'use client'

/**
 * 옵션 선택 (TASK-0043 F1 · F2 · F3).
 *
 * **품절과 없는 조합을 같은 회색으로 칠하지 않는다.** 하나는 있는 조합이고 지금
 * 살 수 없는 것, 다른 하나는 판매자가 만든 적이 없는 것이다. 둘 다 못 고르는 것은
 * 같지만 이유가 다르고, 손님이 다음에 할 행동도 다르다 — 품절은 기다리면 되고
 * 없는 조합은 기다려도 오지 않는다. 그래서 낱말이 둘이고, 보조 기술에도 각각
 * 그대로 읽힌다.
 *
 * `aria-disabled` 이고 네이티브 `disabled` 가 아니다. 탭으로 닿지 못하는 컨트롤은
 * **왜** 못 누르는지 알 수 없다 — `docs/design/pages.md` 의 규약이고, 여기서는 그
 * 이유가 화면의 절반이다.
 */

import type { Product } from '@shopping/shared'

import type { Selection, ValueAvailability } from '@/lib/products/variant-selection'
import { availability } from '@/lib/products/variant-selection'
import type { ProductOptionMessages } from '@/messages'

const STATE_STYLES: Readonly<Record<ValueAvailability, string>> = {
  available: 'border-border-interactive bg-surface text-fg hover:border-fg-subtle',
  sold_out: 'border-border bg-surface-muted text-fg-subtle line-through',
  missing: 'border-border border-dashed bg-surface text-fg-subtle',
}

export interface OptionPickerProps {
  readonly product: Product
  readonly selection: Selection
  readonly onChoose: (optionId: string, valueId: string) => void
  readonly messages: ProductOptionMessages
}

export function OptionPicker({ product, selection, onChoose, messages }: OptionPickerProps) {
  const states = availability(product, selection)

  if (product.options.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {product.options.map((option) => (
        <fieldset className="flex flex-col gap-2" key={option.id}>
          <legend className="text-fg text-sm font-medium">{option.name}</legend>

          <ul className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const state = states[option.id]?.[value.id] ?? 'available'
              const chosen = selection[option.id] === value.id
              const unavailable = state !== 'available'

              return (
                <li key={value.id}>
                  <button
                    aria-disabled={unavailable}
                    aria-pressed={chosen}
                    className={`min-h-touch inline-flex items-center gap-1 rounded-md border px-3 text-sm ${
                      chosen ? 'border-primary bg-primary-surface text-fg' : STATE_STYLES[state]
                    }`}
                    onClick={() => {
                      // Reachable by keyboard on purpose (`aria-disabled`), so
                      // the click has to be the thing that refuses.
                      if (!unavailable) onChoose(option.id, value.id)
                    }}
                    type="button"
                  >
                    {value.value}
                    {state === 'available' ? null : (
                      <span className="text-fg-subtle text-xs no-underline">
                        {state === 'sold_out' ? messages.soldOut : messages.missing}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  )
}
