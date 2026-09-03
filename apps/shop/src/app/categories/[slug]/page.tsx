import { notFound } from 'next/navigation'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/**
 * A category, until TASK-0042 makes it a product list.
 *
 * The slug is checked against the header's own list rather than accepted as
 * given: an unknown category is a 404, not a page titled with whatever was in
 * the URL. That is also what makes `not-found.tsx` reachable in a real browser.
 */
export default async function CategoryPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>
}) {
  const messages = messagesFor()
  const { slug } = await params

  const category = messages.layout.nav.categories.find((entry) => entry.slug === slug)
  if (category === undefined) notFound()

  return <PlaceholderScreen body={messages.placeholder.category.body} title={category.label} />
}
