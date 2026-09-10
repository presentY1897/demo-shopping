'use client'

import {
  API_PATH_PREFIX,
  APP_ID_HEADER,
  checkoutDraftResponseSchema,
  checkoutDraftSchema,
} from '@shopping/shared'
import type { CheckoutDraft } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiBaseUrl, APP_ID, getApiClient, getSessionClient } from '@/lib/api'
import { useAuth } from '@/lib/auth/auth-context'

export function useCheckoutDraft(id: string, restore: (ids: readonly string[]) => void) {
  const { state: auth } = useAuth()
  const [draft, setDraft] = useState<CheckoutDraft>(() => checkoutDraftSchema.parse({}))
  const current = useRef(draft)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const dirty = useRef(false)
  const pending = useRef<CheckoutDraft | null>(null)
  const running = useRef(false)
  const write = useCallback(
    (value: CheckoutDraft) => {
      pending.current = value
      if (running.current) return queue.current
      running.current = true
      queue.current = (async () => {
        while (pending.current !== null) {
          const next = pending.current
          pending.current = null
          await getApiClient().request({
            path: `/checkouts/${id}/draft`,
            method: 'PATCH',
            body: next,
            schema: checkoutDraftResponseSchema,
          })
          if (current.current === next) dirty.current = false
          setFailed(false)
        }
      })().finally(() => {
        running.current = false
      })
      void queue.current.catch(() => setFailed(true))
      return queue.current
    },
    [id],
  )
  const update = useCallback(
    (patch: Partial<CheckoutDraft>) => {
      const next = { ...current.current, ...patch }
      if (JSON.stringify(next) === JSON.stringify(current.current)) return
      next.revision = current.current.revision + 1
      current.current = next
      dirty.current = true
      setDraft(next)
      void write(next)
    },
    [write],
  )
  const flush = useCallback(async () => {
    if (dirty.current) await write(current.current)
    else await queue.current
  }, [write])

  useEffect(() => {
    if (auth.status === 'checking') return
    const controller = new AbortController()
    void getApiClient()
      .request({
        path: `/checkouts/${id}/draft`,
        schema: checkoutDraftResponseSchema,
        signal: controller.signal,
      })
      .then((answer) => {
        if (controller.signal.aborted) return
        current.current = answer.draft
        setDraft(answer.draft)
        restore(answer.draft.userCouponIds)
        setReady(true)
        setLoadFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReady(true)
          setFailed(true)
          setLoadFailed(true)
        }
      })
    return () => controller.abort()
  }, [auth.status, id, restore, attempt])

  useEffect(() => {
    const save = () => {
      if (!dirty.current) return
      const token = getSessionClient().accessToken()
      if (token === null) return
      void fetch(`${apiBaseUrl()}${API_PATH_PREFIX}/checkouts/${id}/draft`, {
        method: 'PATCH',
        keepalive: true,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          [APP_ID_HEADER]: APP_ID,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(current.current),
      }).catch(() => undefined)
    }
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [id])
  return {
    draft,
    ready,
    failed,
    loadFailed,
    update,
    flush,
    retry: () => setAttempt((value) => value + 1),
  }
}
