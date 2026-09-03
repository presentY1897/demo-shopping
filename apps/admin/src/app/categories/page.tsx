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
 * **The chrome is deliberately one `<main>`.** The console layout — navigation,
 * header, breadcrumbs — is TASK-0019's, and anything invented here would have to
 * be removed again. This page is written so that adopting it is wrapping the
 * `<main>` and deleting the heading.
 */
export default function CategoriesPage() {
  const { categories, errors, errorNotice } = messagesFor()

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-primary text-2xl font-bold">{categories.title}</h1>
        <p className="text-fg-muted mt-1">{categories.description}</p>
      </header>

      <CategoryManager errors={errors} messages={categories} notice={errorNotice} />
    </main>
  )
}
