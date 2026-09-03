/**
 * The current time, as a dependency.
 *
 * Expiry sweeps, settlement cut-offs and token lifetimes all compare against
 * "now", and a test can only pin that value down if the code asks for it
 * instead of reading the system clock. Pure logic therefore takes `now` as an
 * argument (`isExpired(user, now)`) and a service takes this port and passes it
 * down.
 *
 * `vi.setSystemTime` is deliberately not the answer: it moves the process clock
 * and leaves the database's `now()` where it was, so a row written with
 * `DEFAULT now()` and the application's idea of the time disagree — and the
 * expiry decision comes out right only in the test.
 *
 * **This file is the one place in `apps/api` allowed to call `new Date()`.**
 * `eslint.config.mjs` enforces that; the exemption exists precisely so the rule
 * can be absolute everywhere else.
 */
export interface Clock {
  now: () => Date
}

/** Injection token; an interface has no runtime value to key a provider on. */
export const CLOCK = Symbol('CLOCK')

/** What production binds: the process clock. */
export class SystemClock implements Clock {
  now(): Date {
    // eslint-disable-next-line no-restricted-syntax -- the exemption this port exists for
    return new Date()
  }
}
