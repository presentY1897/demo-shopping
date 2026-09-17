'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { HealthResult } from './health'
import { loadHealth } from './health'
import { wakeApi } from './wake'
import type { WakePolicy } from './wake-policy'
import { WAKE_POLICY } from './wake-policy'

export interface WakeState {
  /** `null` while the API has not answered yet — the loading state. */
  readonly result: HealthResult | null
  /**
   * 1-based, kept for logging and for a spec to assert the loop is turning.
   *
   * **Not shown to the visitor.** The total is no longer knowable up front — the
   * budget is wall-clock, not a count — and "7번째 시도" answers a question
   * nobody asked. The elapsed counter and the progress bar say the thing the
   * visitor wants to know (TASK-0118 4.7).
   */
  readonly attempt: number
  readonly elapsedMs: number
  /**
   * The API has answered and said search is not ready, and the loop is still
   * asking. Only ever true under {@link WakeOptions.waitForSearch}, and only
   * means something while `result` is `null` — once the loop returns, `result`
   * is the word on search.
   */
  readonly searchPending: boolean
  /** Automatic search re-checks already spent. Equal to the budget means done. */
  readonly searchRechecks: number
  readonly searchRecheckBudget: number
  /** Starts the whole sequence again and refills the re-check budget. */
  readonly retry: () => void
}

export interface WakeOptions {
  /**
   * Keep asking, inside the same budget, until `search` is `"ok"` as well.
   *
   * **A property of the screen, not of the policy**, which is why it is not a
   * field of {@link WakePolicy}: the policy is how long anybody waits and is the
   * same three files in three apps, while this is whether the screen can do
   * anything without search. The storefront cannot — its rows *are* searches —
   * so it waits. A console can, shows search as one line of a panel, and leaves
   * this off (TASK-0143 4.3).
   */
  readonly waitForSearch?: boolean
}

/**
 * Wakes the API on mount and keeps the screen honest about the wait.
 *
 * Runs in an effect, so nothing happens during server rendering: the page's HTML
 * is produced without a single await and the request starts when the browser
 * takes over (TASK-0101 4.3, F4).
 *
 * **Nothing here polls.** The retry loop is bounded, the search re-checks are
 * bounded, and the only other triggers are events the visitor caused — coming
 * back online, or bringing the tab forward. An app that pinged on a timer would
 * keep two free services awake around the clock, which is 1460 instance hours
 * against a shared budget of 750 (TASK-0009 R8).
 *
 * @param policy Must be a stable reference; it is an effect dependency. The
 *   default is a module constant, and specs pass their own module constant.
 */
export function useApiWake(
  policy: WakePolicy = WAKE_POLICY,
  { waitForSearch = false }: WakeOptions = {},
): WakeState {
  const [run, setRun] = useState(0)
  const [attempt, setAttempt] = useState(1)
  const [result, setResult] = useState<HealthResult | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [searchPending, setSearchPending] = useState(false)

  // A ref as well as state: the automatic re-check has to read the count inside
  // a timeout without making itself a dependency of the effect that owns it.
  const rechecksRef = useRef(0)
  const [searchRechecks, setSearchRechecks] = useState(0)

  /**
   * Back to the waiting state, with a fresh budget.
   *
   * The reset lives here rather than at the top of the effect below: an effect
   * that sets state as its first act renders twice for every start, and the
   * lint rule that catches it is right — every caller of `retry` is already an
   * event (a click, `online`, the tab coming forward), which is where a state
   * change belongs.
   */
  const retry = useCallback(() => {
    rechecksRef.current = 0
    setSearchRechecks(0)
    setAttempt(1)
    setResult(null)
    setElapsedMs(0)
    setSearchPending(false)
    setRun((previous) => previous + 1)
  }, [])

  // The wake-up itself, restarted whenever `retry` bumps `run`.
  useEffect(() => {
    const controller = new AbortController()
    const startedAt = performance.now()

    const ticker = setInterval(() => {
      setElapsedMs(performance.now() - startedAt)
    }, policy.tickMs)

    // `result` stays `null` until the loop returns, whichever way this is set:
    // an answer in between is not the outcome, and a caller that does not wait
    // for search must see exactly the sequence it saw before there was a choice.
    const onSearchPending = waitForSearch
      ? (): void => {
          setSearchPending(true)
        }
      : undefined

    void wakeApi(policy, controller.signal, setAttempt, onSearchPending).then((outcome) => {
      clearInterval(ticker)
      if (controller.signal.aborted) return

      setElapsedMs(performance.now() - startedAt)
      setResult(outcome)
    })

    return () => {
      controller.abort()
      clearInterval(ticker)
    }
  }, [policy, run, waitForSearch])

  // Wake-up detected from the outside: the network came back, or the visitor
  // returned to a tab that had given up. One request each, and only from a
  // failed state — a healthy screen has nothing to re-ask.
  const failed = result !== null && !result.ok

  useEffect(() => {
    if (!failed) return

    const onOnline = (): void => {
      retry()
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') retry()
    }

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [failed, retry])

  // The search engine is a separate free service and wakes on its own schedule,
  // so it is routinely still down when the API is already answering (TASK-0009
  // R10). These re-checks are what turn "준비 중" back into a usable search
  // without the visitor doing anything — and they stop, on their own, after the
  // budget in the policy.
  //
  // **Not for a caller that waited for search.** Its loop already spent the
  // whole budget asking this very question, so an answer that still says "not
  // ready" is where the asking ends: re-checks on top would be requests past
  // the ceiling the budget exists to set (TASK-0143 R3).
  const searchNotReady = !waitForSearch && result?.ok === true && result.response.search !== 'ok'

  useEffect(() => {
    if (!searchNotReady) return

    const delayMs = policy.searchRecheckDelaysMs[rechecksRef.current]
    if (delayMs === undefined) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      rechecksRef.current += 1

      void loadHealth({
        timeoutMs: policy.searchRecheckTimeoutMs,
        signal: controller.signal,
      }).then((outcome) => {
        if (controller.signal.aborted) return

        setSearchRechecks(rechecksRef.current)
        // A failed re-check leaves the last good payload on screen. The API
        // answered a moment ago; one dropped request is not news worth showing.
        if (outcome.ok) setResult(outcome)
      })
    }, delayMs)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [policy, searchNotReady, searchRechecks])

  return {
    attempt,
    elapsedMs,
    result,
    retry,
    searchPending,
    searchRecheckBudget: policy.searchRecheckDelaysMs.length,
    searchRechecks,
  }
}
