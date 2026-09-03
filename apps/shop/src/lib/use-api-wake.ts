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
  /** 1-based, so the screen can say which of the attempts is running. */
  readonly attempt: number
  readonly attempts: number
  readonly elapsedMs: number
  /** Automatic search re-checks already spent. Equal to the budget means done. */
  readonly searchRechecks: number
  readonly searchRecheckBudget: number
  /** Starts the whole sequence again and refills the re-check budget. */
  readonly retry: () => void
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
export function useApiWake(policy: WakePolicy = WAKE_POLICY): WakeState {
  const [run, setRun] = useState(0)
  const [attempt, setAttempt] = useState(1)
  const [result, setResult] = useState<HealthResult | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

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
    setRun((previous) => previous + 1)
  }, [])

  // The wake-up itself, restarted whenever `retry` bumps `run`.
  useEffect(() => {
    const controller = new AbortController()
    const startedAt = performance.now()

    const ticker = setInterval(() => {
      setElapsedMs(performance.now() - startedAt)
    }, policy.tickMs)

    void wakeApi(policy, controller.signal, setAttempt).then((outcome) => {
      clearInterval(ticker)
      if (controller.signal.aborted) return

      setElapsedMs(performance.now() - startedAt)
      setResult(outcome)
    })

    return () => {
      controller.abort()
      clearInterval(ticker)
    }
  }, [policy, run])

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
  const searchNotReady = result?.ok === true && result.response.search !== 'ok'

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
    attempts: policy.attemptTimeoutsMs.length,
    elapsedMs,
    result,
    retry,
    searchRecheckBudget: policy.searchRecheckDelaysMs.length,
    searchRechecks,
  }
}
