import { RequireSignIn } from '@/components/auth/require-sign-in'
import { MyPageShell } from '@/components/mypage/mypage-shell'
import { SettingsScreen } from '@/components/mypage/settings-screen'
import { messagesFor } from '@/messages'

/**
 * Profile, display density, notifications and withdrawal (TASK-0112).
 *
 * A server component around a client one: the frame — heading, nav, the shell
 * around it — is rendered and sent while the API may still be waking up, and
 * only the part that holds a session and a form crosses the boundary.
 *
 * **`RequireSignIn` invites rather than redirects.** `apps/shop` is a public
 * site and bouncing somebody off the address they bookmarked would lose it; the
 * two consoles redirect because they have nothing at all to show without a role
 * (TASK-0023 4장).
 */
export default function SettingsPage() {
  const messages = messagesFor()
  const copy = messages.mypage

  return (
    <MyPageShell
      current="settings"
      description={copy.settings.description}
      nav={copy.nav}
      title={copy.settings.title}
    >
      <RequireSignIn messages={messages.auth.requireSignIn}>
        <SettingsScreen messages={messages} />
      </RequireSignIn>
    </MyPageShell>
  )
}
