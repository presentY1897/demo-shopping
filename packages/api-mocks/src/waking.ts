import type { JsonBodyType, RequestHandler } from 'msw'
import { delay, http, HttpResponse } from 'msw'

import type { MockPath } from './paths'

/**
 * A cold API, as a front-end spec can hold it still and look at it.
 *
 * The deployed API sleeps after 15 minutes and takes about 90 seconds to answer
 * the first request after that (TASK-0101 4.1). None of these helpers wait that
 * long: the wake-up policy is a value the component takes, so a spec hands it
 * millisecond thresholds and reproduces the same sequence in a fraction of a
 * second. What is being checked is the *order of events*, not the clock.
 *
 * The real numbers are pinned separately, by asserting on the policy constant
 * itself — a check that cannot be made to pass by a slow machine.
 */

/**
 * Answers `path` only after `ms`, with a normal 200.
 *
 * This is the shape of a slow wake-up: nothing is broken, the answer is just
 * late. It is what the delay notice has to appear on top of.
 */
export function slowResponse(path: MockPath, ms: number, body: JsonBodyType): RequestHandler {
  return http.get(path, async () => {
    await delay(ms)
    return HttpResponse.json(body)
  })
}

/**
 * Never answers `path`.
 *
 * The caller's own deadline is what ends the request, which is precisely the
 * failure a sleeping instance produces when the wait is capped too low.
 */
export function neverAnswers(path: MockPath): RequestHandler {
  return http.get(path, async () => {
    await delay('infinite')
  })
}

/**
 * Fails the first `coldAttempts` requests, then answers normally.
 *
 * The recovery case: the visitor does nothing, the retry loop keeps going, and
 * the instance finishes booting between two attempts. A transport error stands
 * in for the wait so the spec stays instant — from the caller's side an aborted
 * deadline and an unreachable host arrive as the same thing, a request with no
 * response.
 */
export function wakesAfter(
  path: MockPath,
  coldAttempts: number,
  body: JsonBodyType,
): RequestHandler {
  let seen = 0

  return http.get(path, () => {
    seen += 1
    return seen <= coldAttempts ? HttpResponse.error() : HttpResponse.json(body)
  })
}
