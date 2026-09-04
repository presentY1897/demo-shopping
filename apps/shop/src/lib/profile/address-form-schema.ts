import type { AddressCreateRequest, AddressUpdateRequest } from '@shopping/shared'
import {
  addressLabelSchema,
  addressLineSchema,
  phoneSchema,
  postalCodeSchema,
  recipientNameSchema,
} from '@shopping/shared'
import { z } from 'zod'

import type { AddressFormErrorMessages } from '@/messages'

/** What the add/edit form holds while it is being filled in. */
export interface AddressFormValues {
  readonly label: string
  readonly recipientName: string
  readonly phone: string
  readonly postalCode: string
  readonly addressLine1: string
  readonly addressLine2: string
  readonly isDefault: boolean
}

/**
 * The form's schema: the contract's rules, wearing the storefront's words.
 *
 * **No format is restated here.** `postalCodeSchema` and `phoneSchema` are the
 * whole of the server's opinion about those two strings — five digits, a
 * landline or a mobile with or without hyphens — and a regular expression
 * copied into a screen is a rule that can be relaxed on one side without the
 * other noticing. So the **predicates** come from `packages/shared` through
 * `safeParse` and only the sentences are this app's, which is the adapter
 * TASK-0017 asks for and `apps/admin`'s attribute form already uses.
 *
 * **`label` and `addressLine2` accept the empty string.** An input is never
 * absent — it holds `''` — while the request schema wants `null` for "no
 * name", "no unit number". Turning one into the other is what
 * {@link addressCreateFrom} does; refusing `''` here would put a validation
 * error under a field nobody was obliged to fill in.
 */
export function addressFormSchema(copy: AddressFormErrorMessages) {
  const optional = (message: string): z.ZodType<string> =>
    z
      .string()
      .trim()
      .refine((value) => value === '' || addressLineSchema.safeParse(value).success, message)

  return z.object({
    label: z
      .string()
      .trim()
      .refine((value) => value === '' || addressLabelSchema.safeParse(value).success, copy.label),
    recipientName: z
      .string()
      .trim()
      .refine((value) => recipientNameSchema.safeParse(value).success, copy.recipientName),
    phone: z
      .string()
      .trim()
      .refine((value) => phoneSchema.safeParse(value).success, copy.phone),
    postalCode: z
      .string()
      .trim()
      .refine((value) => postalCodeSchema.safeParse(value).success, copy.postalCode),
    addressLine1: z
      .string()
      .trim()
      .refine((value) => addressLineSchema.safeParse(value).success, copy.addressLine1),
    addressLine2: optional(copy.addressLine2),
    isDefault: z.boolean(),
  })
}

/** `''` is what an untouched optional input holds; `null` is what it means. */
function orNull(value: string): string | null {
  return value === '' ? null : value
}

export function addressCreateFrom(values: AddressFormValues): AddressCreateRequest {
  return {
    label: orNull(values.label),
    recipientName: values.recipientName,
    phone: values.phone,
    postalCode: values.postalCode,
    addressLine1: values.addressLine1,
    addressLine2: orNull(values.addressLine2),
    isDefault: values.isDefault,
  }
}

/**
 * The same values as an edit.
 *
 * **`isDefault` is dropped**, because `addressUpdateRequestSchema` has no room
 * for it: promotion clears the previous default in one transaction and giving
 * that operation a second door would give it one that cannot hold the
 * invariant. The form still shows the switch while editing — the screen sends
 * it to `POST /me/addresses/:id/default` instead.
 */
export function addressUpdateFrom(values: AddressFormValues): AddressUpdateRequest {
  const { isDefault: _promotion, ...rest } = addressCreateFrom(values)

  return rest
}
