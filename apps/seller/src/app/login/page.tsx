import { Skeleton } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'
import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SignInScreen } from '@/components/auth/sign-in-screen'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = { title: messages.auth.signIn.title }

/**
 * `/login` — where the OAuth callback sends the browser back (TASK-0021 복귀 계약).
 *
 * Drawn outside the console shell (`ConsoleFrame`): a sidebar over a sign-in
 * form would be thirteen links nobody signed in can follow.
 *
 * The screen reads the query string, so it is a client component; this file
 * stays a server component so the heading is in the first paint and the
 * `<Suspense>` boundary `useSearchParams` requires has something to show.
 */
export default function LoginPage() {
  return (
    <PageContainer className="flex max-w-lg flex-col py-10">
      <Suspense
        fallback={
          <div aria-busy="true" aria-label={messages.auth.signIn.checkingLabel} role="status">
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        <SignInScreen demo={messages.demo} messages={messages.auth} />
      </Suspense>
    </PageContainer>
  )
}
