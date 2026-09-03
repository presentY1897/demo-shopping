/**
 * "There is nothing here" — as a component, so it cannot be forgotten.
 *
 * TASK-0016 1장: 로딩 / 빈 상태 / 에러 를 매번 새로 만들지 않게 규격을 정한다.
 * The empty case is the one that gets skipped, because it is the one a
 * developer with seed data never sees.
 *
 * `role="status"` rather than a plain `<div>`: a list usually becomes empty
 * *because the user did something* — applied a filter, searched — and a screen
 * reader user who gets no announcement is left with a page that appears not to
 * have responded.
 *
 * The title is a `<p>`, not a heading. A component that cannot see the page it
 * lands in cannot know which level would be correct, and a wrong level is a real
 * defect (axe `heading-order`) where a paragraph is merely plain.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

export interface EmptyStateProps {
  /** 검색 결과가 없습니다 — supplied by the app; this package has no copy. */
  readonly title: ReactNode
  readonly description?: ReactNode
  /** A glyph or illustration. Domain icons belong to the apps. */
  readonly icon?: ReactNode
  /** Usually a `Button` — 필터 초기화, 상품 등록하기. */
  readonly action?: ReactNode
  readonly className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'border-border text-fg flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center',
        className,
      )}
      role="status"
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="text-fg-subtle">
          {icon}
        </span>
      )}
      <p className="text-base font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="text-fg-muted max-w-96 text-sm">{description}</p>
      )}
      {action}
    </div>
  )
}
