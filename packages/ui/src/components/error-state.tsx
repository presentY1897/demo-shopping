/**
 * "It broke" — with a way out.
 *
 * QUALITY-GATES U6 asks that a server error reaches the user, and the failure
 * mode this component exists to prevent is the list that renders empty when the
 * request actually failed. "결과가 없습니다" for a 500 is worse than an error
 * message: the reader stops looking.
 *
 * `role="alert"` because this is an assertive interruption — the thing the
 * reader asked for did not arrive. `EmptyState` uses the polite `status` role
 * for the opposite reason.
 *
 * The retry button's label is required *by the type* whenever `onRetry` is
 * given. An unlabelled icon-only retry is the defect the a11y gate would catch
 * one commit later; making it a compile error catches it now.
 */

import type { ReactNode } from 'react'

import { Button } from './button'
import { cx } from '../lib/cx'

interface ErrorStateBaseProps {
  /** 주문을 불러오지 못했습니다 — from the app's message catalog. */
  readonly title: ReactNode
  readonly description?: ReactNode
  /**
   * Technical detail: a request id, a status code, the API's `code`. Rendered in
   * a monospace line under the description so support can read it back, and kept
   * separate from `description` so the human sentence stays a human sentence.
   */
  readonly detail?: ReactNode
  readonly icon?: ReactNode
  /** An escape hatch other than retrying — 문의하기, 목록으로. */
  readonly action?: ReactNode
  readonly className?: string
}

type RetryProps =
  | { readonly onRetry: () => void; readonly retryLabel: string }
  | { readonly onRetry?: undefined; readonly retryLabel?: undefined }

export type ErrorStateProps = ErrorStateBaseProps & RetryProps

export function ErrorState({
  title,
  description,
  detail,
  icon,
  action,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cx(
        'border-danger bg-danger-surface text-fg flex flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center',
        className,
      )}
      role="alert"
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="text-danger">
          {icon}
        </span>
      )}
      <p className="text-base font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="text-fg-muted max-w-96 text-sm">{description}</p>
      )}
      {detail === undefined ? null : (
        <p className="text-fg-subtle font-mono text-2xs break-all">{detail}</p>
      )}
      {onRetry === undefined ? null : (
        <Button onClick={onRetry} size="sm" variant="outline">
          {retryLabel}
        </Button>
      )}
      {action}
    </div>
  )
}
