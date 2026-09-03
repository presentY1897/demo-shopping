'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Runs a submit once at a time (U3).
 *
 * A disabled button is not enough on its own: the second Enter of a double press
 * arrives before React has re-rendered with `submitting: true`, so the guard is
 * a ref the handler reads synchronously and the state is only what the button
 * renders from.
 *
 * Moves to TASK-0017's form system; see `field-errors.ts`.
 */
export function useSubmit<TResult>(run: () => Promise<TResult>): {
  readonly submitting: boolean
  readonly submit: () => Promise<TResult | undefined>
} {
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)

  const submit = useCallback(async (): Promise<TResult | undefined> => {
    if (inFlight.current) return undefined

    inFlight.current = true
    setSubmitting(true)

    try {
      return await run()
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }, [run])

  return { submitting, submit }
}
