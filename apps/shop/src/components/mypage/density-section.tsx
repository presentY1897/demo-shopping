'use client'

import { Card } from '@shopping/ui/components'
import { DensityToggle } from '@shopping/ui/layout'

import { useDensitySync } from '@/components/layout/account-density-provider'
import type { DensityControlMessages, DensitySettingMessages, MyPageMessages } from '@/messages'

import { AccountNotice, AccountWriteFailure } from './account-notices'

/**
 * The density toggle, in the one place a person comes looking for it.
 *
 * **The same control as the header's, with the words shown.** `DensityToggle`
 * already takes `showLabels`; the header form is icon-only because a storefront
 * header cannot spare 132px, and here there is room. A settings screen that made
 * somebody hover three icons to learn what they do would be a worse version of a
 * control that already exists (TASK-0018 4.3).
 *
 * **This component saves nothing.** Every step change — from this toggle or from
 * the header's — goes through `DensityProvider.onPersist`, which is
 * `AccountDensityProvider`'s single writer. Saving here as well would mean two
 * `PATCH /me/preferences` per click, or a second path that could drift. What
 * this screen owns is the only thing the header cannot: **saying how it went**,
 * because this is the one place somebody is looking at the control when they
 * press it.
 *
 * **The change applies before it is saved, and stays applied if the save
 * fails.** `setDensity` writes the attribute, localStorage and every subscriber
 * synchronously. A toggle that waited for a round trip would sit dead for the
 * length of a cold start, and this is the one setting whose effect the person
 * can see with their own eyes — so the failure says what is actually true: it
 * is kept on this device and not on the account.
 */
export function DensitySection({
  copy,
  toggleCopy,
  messages,
}: {
  readonly copy: DensitySettingMessages
  /** The step names, borrowed from the header's catalog so there is one set. */
  readonly toggleCopy: DensityControlMessages
  readonly messages: MyPageMessages
}) {
  const sync = useDensitySync()

  return (
    <Card as="article" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <DensityToggle labels={toggleCopy.names} legend={copy.title} legendHidden showLabels />

      {sync.status === 'saved' ? <AccountNotice>{copy.savedNotice}</AccountNotice> : null}

      {sync.status === 'failed' && sync.failure !== null ? (
        <AccountWriteFailure failure={sync.failure} messages={messages} title={copy.saveError} />
      ) : null}
    </Card>
  )
}
