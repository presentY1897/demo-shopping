'use client'

import { useAccount } from '@/lib/profile/use-account'
import type { Messages } from '@/messages'

import { AccountLoadFailure, AccountLoading } from './account-notices'
import { DensitySection } from './density-section'
import { NotificationSection } from './notification-section'
import { ProfileForm } from './profile-form'
import { WithdrawalSection } from './withdrawal-section'

/**
 * `/mypage/settings` — profile, display density, notifications, withdrawal.
 *
 * **Four sections, one read.** `GET /me` answers the profile and the settings
 * row together, so the screen has one loading state rather than four panels
 * arriving separately (TASK-0111 4장).
 *
 * **The density section is outside the loading branch**, and that is the only
 * asymmetry here. The toggle's value does not come from this read at all — it
 * comes from `@shopping/ui/density`, which the boot script already filled before
 * React hydrated. Putting it behind the skeleton would hide a working control
 * for the length of a request that it does not depend on, which on a cold start
 * is up to ninety seconds (TASK-0101).
 */
export function SettingsScreen({ messages }: { readonly messages: Messages }) {
  const account = useAccount()
  const copy = messages.mypage

  return (
    <div className="flex flex-col gap-6">
      <DensitySection
        copy={copy.settings.density}
        messages={copy}
        toggleCopy={messages.layout.density}
      />

      {account.state.status === 'loading' ? (
        <AccountLoading label={copy.loadingLabel} rows={2} />
      ) : null}

      {account.state.status === 'error' ? (
        <AccountLoadFailure
          failure={account.state.failure}
          messages={copy}
          onRetry={account.reload}
        />
      ) : null}

      {account.state.status === 'ready' ? (
        <>
          <ProfileForm
            copy={copy.settings.profile}
            messages={copy}
            onSubmit={account.saveProfile}
            profile={account.state.profile}
            roleNames={messages.auth.menu.roleNames}
          />

          <NotificationSection
            copy={copy.settings.notifications}
            messages={copy}
            onSave={account.savePreference}
            preference={account.state.preference}
          />

          <WithdrawalSection
            copy={copy.settings.withdrawal}
            messages={copy}
            onWithdraw={account.withdraw}
          />
        </>
      ) : null}
    </div>
  )
}
