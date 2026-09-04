'use client'

import { sellerBrandNameSchema } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { checkBrandName } from './store-api'

/**
 * Whether the brand name being typed is still free (TASK-0109 F3).
 *
 * **A convenience, never the decision.** Two applications can both be told
 * `available: true` and only one of them can be stored, because this is a read
 * and `Seller_brandName_key` is the constraint (TASK-0108 4장). So `available`
 * promises nothing and only `taken` changes what the form does — the submit is
 * blocked and the message goes under the input, which is the same place the
 * server's own 409 lands (R2).
 *
 * **`unknown` is not `taken`.** A check that could not be made — the API is
 * asleep, the request was aborted — must not stop somebody applying. The screen
 * says nothing and the submit goes through to the endpoint that can decide.
 *
 * **The answer is stored with the name it is about, and everything else is
 * derived.** That is what makes "checking" a fact about the current input rather
 * than a flag somebody has to remember to clear, and it makes a late answer
 * about an old name unshowable rather than merely unlikely — the abort is then a
 * saving of work rather than the thing correctness rests on.
 */

export type BrandNameAvailability =
  /** Nothing worth asking about: unchanged, or not yet a valid name. */
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'available' }
  | { readonly status: 'taken' }
  /** The check itself failed. Reported to nobody; the submit is not blocked. */
  | { readonly status: 'unknown' }

/**
 * How long the typing has to stop before the question is asked.
 *
 * Short enough that the answer arrives while the reader is still looking at the
 * field, long enough that a name is not one request per keystroke.
 */
export const BRAND_NAME_CHECK_DEBOUNCE_MS = 300

/** What the endpoint said, about which name. `available: null` is "it failed". */
interface Answer {
  readonly value: string
  readonly available: boolean | null
}

export interface BrandNameAvailabilityOptions {
  /**
   * The name the store already has, if it has one.
   *
   * Skipped rather than asked, and the difference is visible: a seller editing
   * their introduction would otherwise be told their own brand name is taken —
   * by the row that is theirs.
   */
  readonly current?: string | null
}

export function useBrandNameAvailability(
  value: string,
  { current = null }: BrandNameAvailabilityOptions = {},
): BrandNameAvailability {
  const [answer, setAnswer] = useState<Answer | null>(null)

  // The same schema the endpoint validates its query with, so the form never
  // spends a round trip asking about a name that would come back a 400.
  const askable = value !== current && sellerBrandNameSchema.safeParse(value).success

  useEffect(() => {
    if (!askable) return undefined

    const controller = new AbortController()
    const timer = setTimeout(() => {
      void checkBrandName(value, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setAnswer(result)
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ value, available: null })
        },
      )
    }, BRAND_NAME_CHECK_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [askable, value])

  if (!askable) return { status: 'idle' }
  if (answer?.value !== value) return { status: 'checking' }
  if (answer.available === null) return { status: 'unknown' }

  return { status: answer.available ? 'available' : 'taken' }
}
