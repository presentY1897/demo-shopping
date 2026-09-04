import { RequireSignIn } from '@/components/auth/require-sign-in'
import { AddressBook } from '@/components/mypage/address-book'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { messagesFor } from '@/messages'

/**
 * The address book (TASK-0112).
 *
 * The frame is server-rendered and the book is a client component, so the
 * heading and the nav are on screen while the list is still being asked for —
 * which on this project's free-tier API can be a while (TASK-0101).
 *
 * M07's checkout reuses `AddressCard` from here rather than this screen
 * (TASK-0050): picking an address at order time is a different job from
 * managing the book.
 */
export default function AddressesPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="addresses"
      description={copy.addresses.description}
      nav={copy.nav}
      title={copy.addresses.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <AddressBook messages={copy} />
      </RequireSignIn>
    </MyPageShell>
  )
}
