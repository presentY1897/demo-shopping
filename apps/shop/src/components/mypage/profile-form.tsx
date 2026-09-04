'use client'

import type { Profile, ProfileUpdateRequest } from '@shopping/shared'
import { profileNameSchema, profileUpdateRequestSchema } from '@shopping/shared'
import { Avatar, Button, Card, Input } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo, useState } from 'react'
import { z } from 'zod'

import type { ApiFailure } from '@/lib/api-failure'
import type { MutationResult } from '@/lib/profile/use-account'
import type { MyPageMessages, ProfileFormMessages } from '@/messages'

import { AccountNotice, AccountWriteFailure } from './account-notices'

/**
 * Name and picture — the only two things about an account a person can change
 * (TASK-0111 `profileUpdateRequestSchema`).
 *
 * **The email is shown and not editable, and it is text rather than a disabled
 * input.** The identity is Google's `sub`, so letting somebody type an address
 * would create a second, unverified one. A disabled input is skipped by the tab
 * order, which would mean a keyboard user could not read the value it was
 * showing them — `apps/admin`'s attribute form settled the same question the
 * same way.
 *
 * **There is no 연락처 field, and that is a decision** (TASK-0112 R3). `User`
 * has no column for one, and the number checkout actually uses is the
 * recipient's on the address; a second copy on the account would disagree with
 * it the first time either changed. It is asked for once, on the address form.
 */
export function ProfileForm({
  profile,
  messages,
  copy,
  roleNames,
  onSubmit,
}: {
  readonly profile: Profile
  readonly messages: MyPageMessages
  readonly copy: ProfileFormMessages
  /** Korean names for the roles, borrowed from the account menu's catalog. */
  readonly roleNames: Readonly<Record<string, string>>
  readonly onSubmit: (body: ProfileUpdateRequest) => Promise<MutationResult>
}) {
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [saved, setSaved] = useState(false)

  const schema = useMemo(() => profileFormSchema(copy), [copy])
  const initialValues = useMemo(
    () => ({ name: profile.name, avatarUrl: profile.avatarUrl ?? '' }),
    [profile.avatarUrl, profile.name],
  )

  const form = useForm<ProfileUpdateRequest>({
    schema,
    initialValues,
    onSubmit: async (values) => {
      setFailure(null)
      setSaved(false)

      const result = await onSubmit(values)

      if (!result.ok) {
        setFailure(result.failure)
        // Thrown so `useForm` takes its failure path: the typed values stay in
        // the boxes (U6) and `mapError` gets the chance to put the server's
        // `details` under the field it named (U2).
        throw new ProfileRejection(result.failure)
      }
      setSaved(true)
    },
    mapError: (error) => (error instanceof ProfileRejection ? placed(error.failure) : undefined),
    submitErrorMessage: copy.submitError,
  })

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{copy.legend}</h2>

      <div className="flex items-center gap-4">
        <Avatar alt={copy.avatarAlt} size="lg" src={profile.avatarUrl ?? undefined} />

        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-fg-muted">{copy.emailLabel}</dt>
            <dd className="text-fg font-medium">{profile.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">{copy.rolesLabel}</dt>
            <dd className="text-fg">
              {profile.roles.map((role) => roleNames[role] ?? role).join(', ')}
            </dd>
          </div>
        </dl>
      </div>

      <p className="text-fg-subtle text-xs">{copy.emailHint}</p>

      <Form aria-label={copy.legend} form={form}>
        <FormError errors={form.formErrors} />

        <FormField form={form} hint={copy.nameHint} label={copy.nameLabel} name="name" required>
          <Input {...form.text('name')} autoComplete="name" placeholder={copy.namePlaceholder} />
        </FormField>

        <FormField form={form} hint={copy.avatarHint} label={copy.avatarLabel} name="avatarUrl">
          <Input
            {...form.text('avatarUrl')}
            autoComplete="off"
            inputMode="url"
            placeholder={copy.avatarPlaceholder}
          />
        </FormField>

        <div className="flex items-center gap-3">
          <Button loading={form.submitting} type="submit" variant="primary">
            {form.submitting ? copy.saving : copy.save}
          </Button>

          {saved && failure === null ? <AccountNotice>{copy.savedNotice}</AccountNotice> : null}
        </div>
      </Form>

      {failure === null ? null : (
        <AccountWriteFailure failure={failure} messages={messages} title={copy.submitError} />
      )}
    </Card>
  )
}

/**
 * The contract's rules, wearing the storefront's words, plus the one thing an
 * `<input>` cannot express.
 *
 * A box is never absent — it holds `''` — while the request schema wants a URL
 * or `null` for "no picture". The transform is the whole of that difference, and
 * doing it here rather than in the submit handler means the value `useForm`
 * validates *is* the body the API will parse. The predicates come from
 * `packages/shared` through `safeParse`, so no rule is stated twice.
 */
function profileFormSchema(copy: ProfileFormMessages): z.ZodType<ProfileUpdateRequest> {
  return z.object({
    name: z
      .string()
      .trim()
      .refine((value) => profileNameSchema.safeParse(value).success, copy.nameError),
    avatarUrl: z
      .string()
      .trim()
      .refine(
        (value) =>
          value === '' || profileUpdateRequestSchema.shape.avatarUrl.safeParse(value).success,
        copy.avatarError,
      )
      .transform((value) => (value === '' ? null : value)),
  })
}

/** Puts a refused save's `details` under the field the server named. */
function placed(failure: ApiFailure): ValidationErrors | undefined {
  if (failure.kind !== 'http') return undefined

  return serverFieldErrors(failure.details, { fields: ['name', 'avatarUrl'] })
}

class ProfileRejection extends Error {
  constructor(readonly failure: ApiFailure) {
    super('profile save rejected')
    this.name = 'ProfileRejection'
  }
}
