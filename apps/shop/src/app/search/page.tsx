import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/**
 * The header's search field submits here. TASK-0041 replaces this file with the
 * real results screen; what it proves today is that the field navigates and that
 * the query survives the trip.
 */
export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const messages = messagesFor().placeholder.search
  const query = (await searchParams).q

  return (
    <PlaceholderScreen body={messages.body} title={messages.title}>
      {typeof query === 'string' && query !== '' ? (
        <p className="text-fg text-sm">
          {messages.queryLabel}: <strong>{query}</strong>
        </p>
      ) : null}
    </PlaceholderScreen>
  )
}
