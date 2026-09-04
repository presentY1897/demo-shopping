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
 * The screen reads the query string, so it is a client component; this file
 * stays a server component so the heading and the copy are in the first paint
 * and the `<Suspense>` boundary `useSearchParams` requires has something to show
 * while the client bundle arrives.
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
        <SignInScreen messages={messages.auth} />
      </Suspense>
    </PageContainer>
  )
}
