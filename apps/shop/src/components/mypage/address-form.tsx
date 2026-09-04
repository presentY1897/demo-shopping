'use client'

import type { Address, ApiFailure } from '@shopping/shared'
import { Button, Card, Input, Switch } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { fieldIds, Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useCallback, useId, useMemo, useRef, useState } from 'react'

import type { AddressFormValues } from '@/lib/profile/address-form-schema'
import { addressFormSchema } from '@/lib/profile/address-form-schema'
import type { PostcodeSearch } from '@/lib/profile/postcode'
import { openPostcodeSearch } from '@/lib/profile/postcode'
import type { AddressFormMessages, MyPageMessages } from '@/messages'

import { AccountWriteFailure } from './account-notices'

/** Every field this form knows about, for placing a server's `details[]`. */
const FIELDS = [
  'label',
  'recipientName',
  'phone',
  'postalCode',
  'addressLine1',
  'addressLine2',
] as const

export type AddressFormOutcome =
  { readonly kind: 'saved' } | { readonly kind: 'rejected'; readonly failure: ApiFailure }

/**
 * Adding or editing one address, with the postal-code search and the manual
 * entry that has to work without it.
 *
 * **Not a dialog.** The address book already has one — the delete confirmation —
 * and the search widget draws itself into a container *inside this form*.
 * Nesting a third-party embed inside a Radix dialog inside another dialog is
 * three focus traps arguing; a panel above the list has none of that and is what
 * `apps/admin`'s attribute editor settled on for the same reason (TASK-0031
 * 4.11).
 *
 * **The three address fields are always editable.** The widget fills them in;
 * it does not own them. Read-only fields would mean an address the widget got
 * slightly wrong could not be corrected, and — the case F6b is about — an
 * address could not be entered at all when the script is blocked. The fallback
 * is therefore not a mode this form switches into: it is the form, with one
 * notice added.
 *
 * **`isDefault` is shown while editing but not sent.** `addressUpdateRequestSchema`
 * has no room for it, because promotion clears the previous default in one
 * transaction and a second door could not hold that. The screen sends it to
 * `POST /me/addresses/:id/default` instead, which is why the switch stays
 * useful on an existing address.
 */
export function AddressForm({
  editing,
  isFirst,
  copy,
  messages,
  onSubmit,
  onCancel,
  /** Injected by specs. Defaults to the real widget, which is loaded on demand. */
  search = openPostcodeSearch,
}: {
  /** The address being edited, or `undefined` while adding one. */
  readonly editing: Address | undefined
  /** No addresses saved yet, so this one becomes the default whatever is asked. */
  readonly isFirst: boolean
  readonly copy: AddressFormMessages
  readonly messages: MyPageMessages
  readonly onSubmit: (values: AddressFormValues) => Promise<AddressFormOutcome>
  readonly onCancel: () => void
  readonly search?: PostcodeSearch
}) {
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [searchState, setSearchState] = useState<'closed' | 'opening' | 'open' | 'unavailable'>(
    'closed',
  )

  const panelId = useId()
  const panel = useRef<HTMLDivElement | null>(null)

  const schema = useMemo(() => addressFormSchema(copy.errors), [copy.errors])
  const initialValues = useMemo(
    () => ({
      label: editing?.label ?? '',
      recipientName: editing?.recipientName ?? '',
      phone: editing?.phone ?? '',
      postalCode: editing?.postalCode ?? '',
      addressLine1: editing?.addressLine1 ?? '',
      addressLine2: editing?.addressLine2 ?? '',
      isDefault: editing?.isDefault ?? isFirst,
    }),
    [editing, isFirst],
  )

  const form = useForm<AddressFormValues>({
    schema,
    initialValues,
    onSubmit: async (values) => {
      setFailure(null)
      const outcome = await onSubmit(values)

      if (outcome.kind === 'rejected') {
        setFailure(outcome.failure)
        // Thrown so `useForm` takes its failure path: the typed values stay in
        // the boxes (U6) and `mapError` places whatever fields the server named.
        throw new AddressRejection(outcome.failure)
      }
    },
    mapError: (error) => (error instanceof AddressRejection ? placed(error.failure) : undefined),
    submitErrorMessage: copy.submitError,
  })

  const { setValue } = form

  /**
   * Moves focus to the unit-number box after the widget answers.
   *
   * By id rather than by a ref, because `Input` does not forward one — and
   * `FormField` is what assigns the id in the first place, so `fieldIds` is
   * reading the same value it wrote rather than a second guess at it. The same
   * idiom `useForm` uses to focus the first invalid control.
   */
  const focusDetail = useCallback((): void => {
    document.getElementById(fieldIds(form.id, 'addressLine2').control)?.focus()
  }, [form.id])

  const openSearch = useCallback(() => {
    const container = panel.current
    if (container === null) return

    container.replaceChildren()
    setSearchState('opening')

    void search({
      container,
      onSelect: ({ postalCode, addressLine1 }) => {
        setValue('postalCode', postalCode)
        setValue('addressLine1', addressLine1)
        setSearchState('closed')
        container.replaceChildren()
        // The one thing the widget cannot know is the unit number, so that is
        // where the person's attention goes next (F6).
        focusDetail()
      },
      onClose: () => {
        setSearchState('closed')
        container.replaceChildren()
      },
    }).then(
      () => {
        setSearchState('open')
      },
      () => {
        // Blocked, dead, or too slow. The three fields were always editable, so
        // nothing has to be unlocked — what changes is that the person is told
        // why the button did nothing and what to do instead (F6b).
        setSearchState('unavailable')
        container.replaceChildren()
      },
    )
  }, [focusDetail, search, setValue])

  const title = editing === undefined ? copy.addTitle : copy.editTitle

  return (
    <Card as="article" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>

      <Form aria-label={title} form={form}>
        <FormError errors={form.formErrors} />

        <FormField form={form} hint={copy.labelHint} label={copy.labelLabel} name="label">
          <Input {...form.text('label')} autoComplete="off" placeholder={copy.labelPlaceholder} />
        </FormField>

        <FormField form={form} label={copy.recipientLabel} name="recipientName" required>
          <Input
            {...form.text('recipientName')}
            autoComplete="name"
            placeholder={copy.recipientPlaceholder}
          />
        </FormField>

        <FormField form={form} hint={copy.phoneHint} label={copy.phoneLabel} name="phone" required>
          <Input
            {...form.text('phone')}
            autoComplete="tel"
            inputMode="tel"
            placeholder={copy.phonePlaceholder}
          />
        </FormField>

        <div className="flex flex-wrap items-end gap-2">
          <FormField
            className="grow"
            form={form}
            label={copy.postalCodeLabel}
            name="postalCode"
            required
          >
            <Input
              {...form.text('postalCode')}
              autoComplete="postal-code"
              inputMode="numeric"
              placeholder={copy.postalCodePlaceholder}
            />
          </FormField>

          {/*
            `type="button"`: `Form` blocks implicit submission, but a search
            button that submitted the form on Enter would still be wrong for
            anyone driving this by keyboard.
          */}
          <Button
            aria-controls={panelId}
            aria-expanded={searchState === 'open'}
            loading={searchState === 'opening'}
            onClick={openSearch}
            type="button"
            variant="outline"
          >
            {searchState === 'opening' ? copy.searchOpening : copy.searchLabel}
          </Button>
        </div>

        {/*
          The widget's own frame. Always in the DOM so `aria-controls` points at
          something that exists — a reference to a missing element is an axe
          `aria-valid-attr-value` violation — and empty until the widget is
          asked for.
        */}
        <div
          aria-label={copy.searchPanelLabel}
          className={searchState === 'open' ? 'border-border h-96 rounded-md border' : 'hidden'}
          id={panelId}
          ref={panel}
          role="group"
        />

        {searchState === 'open' ? (
          <div className="flex">
            <Button
              onClick={() => {
                setSearchState('closed')
                panel.current?.replaceChildren()
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {copy.searchClose}
            </Button>
          </div>
        ) : null}

        {searchState === 'unavailable' ? (
          <div className="border-border bg-surface-muted rounded-md border p-3" role="status">
            <p className="text-fg text-sm font-medium">{copy.manualTitle}</p>
            <p className="text-fg-muted text-xs">{copy.manualBody}</p>
          </div>
        ) : null}

        <FormField form={form} label={copy.addressLine1Label} name="addressLine1" required>
          <Input
            {...form.text('addressLine1')}
            autoComplete="address-line1"
            placeholder={copy.addressLine1Placeholder}
          />
        </FormField>

        <FormField
          form={form}
          hint={copy.addressLine2Hint}
          label={copy.addressLine2Label}
          name="addressLine2"
        >
          <Input
            {...form.text('addressLine2')}
            autoComplete="address-line2"
            placeholder={copy.addressLine2Placeholder}
          />
        </FormField>

        <Switch
          checked={form.values.isDefault === true}
          description={isFirst ? copy.firstIsDefaultHint : copy.makeDefaultHint}
          // The first address becomes the default whatever the request says
          // (TASK-0111 4장), so offering the choice would be offering a lie.
          disabled={isFirst}
          label={copy.makeDefaultLabel}
          name="isDefault"
          onCheckedChange={(checked) => {
            setValue('isDefault', checked)
          }}
        />

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {copy.cancel}
          </Button>
          <Button loading={form.submitting} type="submit" variant="primary">
            {form.submitting ? copy.saving : copy.save}
          </Button>
        </div>
      </Form>

      {failure === null ? null : (
        <AccountWriteFailure failure={failure} messages={messages} title={copy.submitError} />
      )}
    </Card>
  )
}

/** Puts a refused save's `details` under the fields the server named. */
function placed(failure: ApiFailure): ValidationErrors | undefined {
  if (failure.kind !== 'http') return undefined

  return serverFieldErrors(failure.details, { fields: [...FIELDS] })
}

class AddressRejection extends Error {
  constructor(readonly failure: ApiFailure) {
    super('address save rejected')
    this.name = 'AddressRejection'
  }
}
