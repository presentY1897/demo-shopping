'use client'

import type { Address, AddressCreateRequest, AddressUpdateRequest } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { apiFailure, hasCode } from '@/lib/api-failure'

import {
  createAddress,
  deleteAddress,
  fetchAddresses,
  makeAddressDefault,
  updateAddress,
} from './client'

/**
 * The address book behind `/mypage/addresses`.
 *
 * **Every write is followed by a read, and that is the design** — not caution.
 * Two of the three rules that keep "기본 배송지가 정확히 1개" true change rows
 * the request never named: making one address the default clears another's flag,
 * and deleting the default promotes a survivor the screen did not choose
 * (TASK-0111 4장). Splicing the one row the API answered with back into the list
 * would leave the old default still wearing its badge, and the screen would be
 * showing a state the database does not hold.
 *
 * One extra request per write buys an answer that is the server's rather than
 * this screen's guess at it. An address book is a handful of rows and the
 * endpoint has no paging, so the request is small by construction.
 */

export type AddressListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly items: readonly Address[] }

export type AddressMutationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure: ApiFailure
      /**
       * The list was re-read as part of failing, so what is on screen has just
       * changed under the reader's cursor and they should be told so.
       *
       * Set for the 409 a lost default assignment produces: the refusal means
       * the state moved, and the only useful next step is to look at where it
       * moved to (F3b).
       */
      readonly reloaded?: boolean
    }

export type AddressRemovalResult =
  | {
      readonly ok: true
      /**
       * The deletion moved the default to another address.
       *
       * The screen says so out loud: nobody asked for that address to become
       * the default, and a badge that moved on its own with no explanation
       * reads as a bug.
       */
      readonly promoted: boolean
    }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface AddressBookConsole {
  readonly state: AddressListState
  readonly reload: () => void
  readonly create: (body: AddressCreateRequest) => Promise<AddressMutationResult>
  readonly save: (id: string, body: AddressUpdateRequest) => Promise<AddressMutationResult>
  readonly remove: (id: string) => Promise<AddressRemovalResult>
  readonly makeDefault: (id: string) => Promise<AddressMutationResult>
}

export function useAddressBook(): AddressBookConsole {
  const [state, setState] = useState<AddressListState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const items = await fetchAddresses({ signal: controller.signal })
        if (controller.signal.aborted) return

        setState({ status: 'ready', items })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  /** Re-reads outside the effect, after a write. Returns what it found. */
  const refetch = useCallback(async (): Promise<readonly Address[]> => {
    const items = await fetchAddresses()
    setState({ status: 'ready', items })

    return items
  }, [])

  /** A re-read that failed is not itself worth reporting — the write was. */
  const afterWrite = useCallback(async (): Promise<void> => {
    await refetch().catch(() => undefined)
  }, [refetch])

  const create = useCallback(
    async (body: AddressCreateRequest): Promise<AddressMutationResult> => {
      try {
        await createAddress(body)
        await afterWrite()

        return { ok: true }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [afterWrite],
  )

  const save = useCallback(
    async (id: string, body: AddressUpdateRequest): Promise<AddressMutationResult> => {
      try {
        await updateAddress(id, body)
        await afterWrite()

        return { ok: true }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [afterWrite],
  )

  const remove = useCallback(
    async (id: string): Promise<AddressRemovalResult> => {
      try {
        // The answer carries the row that left, which is how the screen knows
        // whether a promotion is even possible without keeping a copy of the
        // list from before the click.
        const removed = await deleteAddress(id)
        const items = await refetch().catch(() => [])

        return { ok: true, promoted: removed.isDefault && items.some((row) => row.isDefault) }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [refetch],
  )

  const makeDefault = useCallback(
    async (id: string): Promise<AddressMutationResult> => {
      try {
        await makeAddressDefault(id)
        await afterWrite()

        return { ok: true }
      } catch (error) {
        const failure = apiFailure(error)
        if (!hasCode(failure, 'CONFLICT')) return { ok: false, failure }

        // Somebody — another tab, another device — made a different address the
        // default while this click was in flight, and the index refused this
        // one. It is **not** retried: the intent was "make *this* one the
        // default", so retrying would overwrite the choice that won in a race
        // neither person can see. Showing where the default actually is now is
        // the whole of the recovery.
        await afterWrite()

        return { ok: false, failure, reloaded: true }
      }
    },
    [afterWrite],
  )

  return { create, makeDefault, reload, remove, save, state }
}
