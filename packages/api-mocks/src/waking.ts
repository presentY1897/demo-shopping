import type { JsonBodyType, RequestHandler } from 'msw'
import { delay, http, HttpResponse } from 'msw'

import type { MockMethod, MockPath } from './paths'

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
  return neverAnswersOn('get', path)
}

/**
 * {@link neverAnswers} for a verb other than `GET`.
 *
 * A mutation that never answers is how a spec holds a screen still *during* a
 * request: an optimistic update has already been drawn and the response that
 * would confirm or undo it has not arrived, which is the only window in which
 * "즉시 반영" can be observed at all.
 */
export function neverAnswersOn(method: MockMethod, path: MockPath): RequestHandler {
  return http[method](path, async () => {
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

/**
 * An instance that is asleep and boots once, **as measured against Render**.
 *
 * The first request starts the instance and is **refused immediately** — the
 * platform edge answers 502 with its own HTML page while the container boots,
 * and keeps doing so until the health check passes. Every request that lands in
 * that window gets the same instant refusal. Then the instance is up and answers
 * normally.
 *
 * ```
 * t=0      first request  → 502 in ~0.3s, boot starts
 * t=…      more requests  → 502, each in ~0.3s
 * t=boot   the edge starts routing → 200
 * ```
 *
 * **This is the second model this helper has had, and the first one was wrong.**
 * It held requests open until the instance answered — see
 * {@link heldRequestInstance}, which keeps that behaviour — and a retry policy
 * that budgets by *attempt* passes against it while failing in production: three
 * attempts against a held request spend their full deadlines, three attempts
 * against an instant 502 spend about a second between them (TASK-0118 4.1).
 *
 * The clock starts on the first request, exactly as the spin-up does.
 */
export function sleepingInstance(
  path: MockPath,
  wakesAfterMs: number,
  body: JsonBodyType,
): RequestHandler {
  let readyAt: number | null = null

  // Not `async`: the refusal is what this helper is *for*, and it involves no
  // waiting at all — which is exactly the difference from the model it replaced.
  return http.get(path, () => {
    readyAt ??= Date.now() + wakesAfterMs

    // **A transport failure, not a 502 — and the difference is the browser.**
    //
    // On the wire the edge answers 502 with its own HTML page. That page carries
    // no `Access-Control-Allow-Origin`, so the browser rejects it before the app
    // sees anything: `fetch` throws and the console reports a CORS violation
    // (TASK-0118 4.2). Modelling the 502 itself would be *less* faithful here —
    // these specs drive a browser app, and a browser never receives it.
    //
    // It matters which one the double produces: a 502 body reaching the client
    // classifies as `malformed_response`, which the wake-up loop treats as final
    // and does not retry (TASK-0118 R8).
    if (Date.now() < readyAt) return HttpResponse.error()

    return HttpResponse.json(body)
  })
}

/**
 * A sleeping instance that **holds** the request until it is up.
 *
 * The model {@link sleepingInstance} used to have, kept because a platform may
 * behave this way — the deadline is shared, so a caller that gives up and asks
 * again joins a wait already in progress rather than restarting it.
 *
 * **A wake-up policy has to survive both.** Which one a deployment gets is not
 * something the front end can choose, and the replay runs against each
 * (TASK-0118 4.6).
 */
export function heldRequestInstance(
  path: MockPath,
  wakesAfterMs: number,
  body: JsonBodyType,
): RequestHandler {
  let readyAt: number | null = null

  return http.get(path, async () => {
    readyAt ??= Date.now() + wakesAfterMs

    const remaining = readyAt - Date.now()
    if (remaining > 0) await delay(remaining)

    return HttpResponse.json(body)
  })
}
