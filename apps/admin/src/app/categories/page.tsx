import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { CategoryManager } from '@/components/categories/category-manager'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.categories.title,
  description: messages.categories.description,
}

/**
 * `/categories` — the category tree an administrator edits (TASK-0029).
 *
 * Static, like the console's other pages: nothing is awaited here, so the shell
 * is prerendered and the tree is fetched by the client boundary below
 * (TASK-0101 4.3). A server render that awaited the API would send no markup at
 * all for as long as a cold instance takes to wake, which is up to ninety
 * seconds.
 *
 * **The chrome is now the console's.** TASK-0029 left a temporary `<main>` and
 * a hand-written heading here, noting that adopting the shell would be wrapping
 * the one and replacing the other. That is what happened: `<main>` belongs to
 * `ConsoleShell`, and the heading is `PageHeader`, which every console screen
 * uses so that titles, actions and filters land in the same place on all of
 * them (TASK-0019 4.6).
 */
export default function CategoriesPage() {
  const { categories, errors, errorNotice } = messagesFor()

  return (
    <>
      <PageHeader description={categories.description} title={categories.title} />

      <CategoryManager errors={errors} messages={categories} notice={errorNotice} />
    </>
  )
}
