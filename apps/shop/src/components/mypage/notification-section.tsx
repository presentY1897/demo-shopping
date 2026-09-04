'use client'

import type { UserPreference, UserPreferenceUpdateRequest } from '@shopping/shared'
import { Card, Switch } from '@shopping/ui/components'
import { useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import type { MutationResult } from '@/lib/profile/use-account'
import type { MyPageMessages, NotificationSettingMessages } from '@/messages'

import { AccountNotice, AccountWriteFailure } from './account-notices'

/** The three switches, in the order the settings row declares them. */
const SWITCHES = ['notifyOrder', 'notifyClaim', 'notifyMarketing'] as const

type NotificationField = (typeof SWITCHES)[number]

/**
 * Which notifications the account wants (TASK-0111 — 알림 수신 여부).
 *
 * **Switches, not a form.** Each one is a single fact with an immediate effect
 * and no other field it has to agree with, so a save button between the press
 * and the result would be ceremony — the WAI-ARIA switch pattern is "on or off,
 * now". `Switch` is a Radix control, so the role, the state and the keyboard
 * behaviour are not this file's to arrange.
 *
 * **One request per press, carrying one field.** `userPreferenceUpdateRequestSchema`
 * is a partial update, so sending the pressed switch alone is the whole body —
 * and sending all three would overwrite two values the person did not touch
 * with whatever this screen last read, which is a lost-update bug waiting for
 * two tabs.
 *
 * **The pressed switch is disabled until its request settles.** That is U3 here:
 * there is no submit button to carry `loading`, so the guard is on the control
 * itself, and it is per-switch rather than per-panel so pressing one does not
 * freeze the other two.
 */
export function NotificationSection({
  preference,
  copy,
  messages,
  onSave,
}: {
  readonly preference: UserPreference
  readonly copy: NotificationSettingMessages
  readonly messages: MyPageMessages
  readonly onSave: (body: UserPreferenceUpdateRequest) => Promise<MutationResult>
}) {
  const [pending, setPending] = useState<NotificationField | null>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [saved, setSaved] = useState(false)

  function toggle(field: NotificationField, checked: boolean): void {
    if (pending !== null) return

    setPending(field)
    setFailure(null)
    setSaved(false)

    void onSave({ [field]: checked }).then((result) => {
      setPending(null)
      if (result.ok) setSaved(true)
      else setFailure(result.failure)
    })
  }

  return (
    <Card as="article" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{copy.legend}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <div className="flex flex-col gap-4">
        {SWITCHES.map((field) => (
          <Switch
            checked={preference[field]}
            description={copy.switches[field].description}
            disabled={pending === field}
            key={field}
            label={copy.switches[field].label}
            name={field}
            onCheckedChange={(checked) => {
              toggle(field, checked)
            }}
          />
        ))}
      </div>

      {saved ? <AccountNotice>{copy.savedNotice}</AccountNotice> : null}

      {failure === null ? null : (
        <AccountWriteFailure failure={failure} messages={messages} title={copy.saveError} />
      )}
    </Card>
  )
}
