import type { HealthStatus } from '@shopping/shared'
import { healthEntries } from '@shopping/shared'

import type { HealthResult } from '@/lib/health'
import type { Messages } from '@/messages'

/** One class per status, so the colour lives in a token and not in the markup. */
const STATUS_STYLES: Record<HealthStatus, string> = {
  ok: 'bg-status-ok',
  degraded: 'bg-status-degraded',
  down: 'bg-status-down',
}

interface HealthPanelProps {
  readonly result: HealthResult
  readonly messages: Messages
}

/**
 * Boot check for the API connection. Deliberately plain: this page is replaced
 * by the real one in M03 and is not a design target (TASK-0006 6.2).
 */
export function HealthPanel({ result, messages }: HealthPanelProps) {
  const { health } = messages

  return (
    <section className="rounded-lg border border-black/10 p-6">
      <h2 className="text-lg font-semibold">{health.title}</h2>

      <p className="mt-1 text-sm text-black/60">
        {health.endpointLabel}: <code>{result.endpoint}</code>
      </p>

      {result.ok ? (
        <>
          <ul className="mt-4 flex flex-col gap-1">
            {healthEntries(result.response).map((entry) => (
              <li
                key={entry.key}
                className="flex min-h-[var(--touch-min)] items-center gap-3 border-b border-black/5 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full ${STATUS_STYLES[entry.status]}`}
                />
                <span className="grow">{health.itemLabels[entry.key] ?? entry.key}</span>
                <span className="font-medium">{health.statusLabels[entry.status]}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-black/60">
            <dt>{health.uptimeLabel}</dt>
            <dd>
              {result.response.uptime}
              {health.uptimeUnit}
            </dd>
            <dt>{health.versionLabel}</dt>
            <dd>{result.response.version}</dd>
          </dl>
        </>
      ) : (
        <div className="mt-4" role="alert">
          <p className="flex items-center gap-3 font-medium">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-status-down" />
            {health.failureTitle}
          </p>
          <p className="mt-1 text-sm text-black/60">{health.failures[result.reason]}</p>
        </div>
      )}
    </section>
  )
}
