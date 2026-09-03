import type { HealthStatus } from '@shopping/shared'
import { Button } from '@shopping/ui/components'

import type { SearchReadinessMessages } from '@/messages'

interface SearchReadinessProps {
  /** The `search` field of the health payload, straight from the API. */
  readonly status: HealthStatus
  readonly messages: SearchReadinessMessages
  /** An automatic re-check is still scheduled, so the visitor need not act. */
  readonly autoRechecking: boolean
  readonly onRecheck: () => void
}

/**
 * Says whether search can be used, and when it cannot, why.
 *
 * The empty state is the point. The search engine is its own free service: it
 * sleeps separately from the API and, having no persistent disk, comes back from
 * a restart with an empty index. Both states answer a query with zero results
 * rather than an error, so without this the screen would show "결과 없음" for a
 * catalogue that is merely still loading (TASK-0101 4.7).
 *
 * The API reports both through `search`: `down` while the engine is unreachable,
 * `degraded` while the index is not query-ready. A visitor cannot act on the
 * difference, so the two only change the sentence.
 */
export function SearchReadiness({
  status,
  messages,
  autoRechecking,
  onRecheck,
}: SearchReadinessProps) {
  if (status === 'ok') {
    return (
      <section className="border-border rounded-lg border p-6">
        <h2 className="text-lg font-semibold">{messages.title}</h2>
        <p className="text-fg-muted mt-1 text-sm">{messages.ready}</p>
      </section>
    )
  }

  return (
    <section className="border-border rounded-lg border p-6">
      <h2 className="text-lg font-semibold">{messages.title}</h2>

      <div className="mt-2" role="status">
        <p className="font-medium">{messages.preparingTitle}</p>
        <p className="text-fg-muted mt-1 text-sm">
          {status === 'down' ? messages.waking : messages.indexing}
        </p>
        {autoRechecking ? (
          <p className="text-fg-subtle mt-1 text-sm">{messages.autoRecheck}</p>
        ) : null}
      </div>

      <Button className="mt-4" onClick={onRecheck} variant="outline">
        {messages.recheckLabel}
      </Button>
    </section>
  )
}
