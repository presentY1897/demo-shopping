'use client'

import { Input, Textarea } from '@shopping/ui/components'
import { FormField } from '@shopping/ui/form'
import type { FormApi } from '@shopping/ui/form'

import type { BrandNameAvailability } from '@/lib/sellers/use-brand-name-availability'
import type { StoreAvailabilityMessages, StoreFormMessages } from '@/messages'

/**
 * The four inputs a store is described by — brand name, address, introduction,
 * logo (TASK-0109 4장).
 *
 * **Both screens render this, unchanged.** `/apply` and `/settings` differ in
 * which request they send and which banner sits above them, not in what a store
 * is; a second copy of these fields would be a second set of labels, hints and
 * lengths to keep in step, which is what TASK-0026 and TASK-0027 were split
 * apart to avoid.
 *
 * Every id, `aria-describedby` and `aria-invalid` comes from `FormField` and the
 * `useForm` binder (TASK-0017 규약), so the label, the hint, the message and the
 * control cannot disagree about which field they belong to.
 */
export function StoreProfileFields({
  form,
  messages,
  availability,
  availabilityMessages,
  slugLocked,
}: {
  readonly form: FormApi
  readonly messages: StoreFormMessages
  readonly availability: BrandNameAvailability
  readonly availabilityMessages: StoreAvailabilityMessages
  /**
   * True once the store exists.
   *
   * The address is out of `sellerStoreUpdateRequestSchema` altogether (TASK-0108
   * R4): renaming it would break every link pointing at the storefront and there
   * is no redirect table to catch them. Shown rather than hidden — a seller has
   * to be able to read their own address — and read-only rather than disabled,
   * so it stays in the tab order and can still be selected and copied.
   */
  readonly slugLocked: boolean
}) {
  return (
    <>
      <FormField
        form={form}
        hint={
          <>
            {messages.brandNameHint}
            {/*
              Always mounted, so the result of the live check is *announced* when
              it changes rather than merely appearing. A live region added to the
              DOM at the moment it has something to say is announced
              inconsistently — the same reason `ErrorNotice` keeps its copy
              confirmation mounted.
            */}
            <span
              aria-live="polite"
              className={`block ${availability.status === 'taken' ? 'text-danger' : ''}`}
            >
              {availability.status === 'idle' || availability.status === 'unknown'
                ? ''
                : availabilityMessages[availability.status]}
            </span>
          </>
        }
        label={messages.brandNameLabel}
        name="brandName"
        required
      >
        <Input {...form.text('brandName')} autoComplete="organization" />
      </FormField>

      <FormField
        form={form}
        hint={slugLocked ? messages.slugLockedHint : messages.slugHint}
        label={messages.slugLabel}
        name="slug"
        required={!slugLocked}
      >
        <Input {...form.text('slug')} autoComplete="off" readOnly={slugLocked} />
      </FormField>

      <FormField
        form={form}
        hint={messages.introductionHint}
        label={messages.introductionLabel}
        name="introduction"
      >
        <Textarea {...form.text('introduction')} rows={5} />
      </FormField>

      <FormField
        form={form}
        hint={messages.logoUrlHint}
        label={messages.logoUrlLabel}
        name="logoUrl"
      >
        <Input {...form.text('logoUrl')} autoComplete="off" inputMode="url" />
      </FormField>
    </>
  )
}
