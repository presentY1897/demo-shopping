import { describe, expect, it } from 'vitest'

import { resolveGoogleOAuthConfig } from './google-config.js'

/**
 * The three rows of TASK-0021 4장 「자격증명은 세트로 검증한다」, and the reason
 * the middle one is not simply "required".
 *
 * `.github/workflows/ci.yml` injects no Google secrets, so "neither set" has to
 * boot — making either variable required would fail every job in the repository
 * rather than the one test that needs a credential. "One set" must not boot: a
 * deployment holding only the id serves everything and then fails inside a token
 * exchange, three frames below the mistake that caused it.
 */

const COMPLETE = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
} as const

/** The variables an issue list names, without their reasons. */
function offenders(source: Record<string, string | undefined>): string[] {
  return resolveGoogleOAuthConfig(source)
    .issues.map((issue) => issue.variable)
    .sort()
}

describe('when neither variable is set', () => {
  it('reports no credentials and no problem, which is what keeps CI green', () => {
    expect(resolveGoogleOAuthConfig({})).toEqual({ config: null, issues: [] })
  })

  it('treats a blank value as unset, the way an env file leaves one', () => {
    expect(resolveGoogleOAuthConfig({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '   ' })).toEqual(
      {
        config: null,
        issues: [],
      },
    )
  })
})

describe('when both are set', () => {
  it('hands back the pair', () => {
    expect(resolveGoogleOAuthConfig(COMPLETE)).toEqual({
      config: { clientId: 'client-id', clientSecret: 'client-secret' },
      issues: [],
    })
  })

  it('ignores everything else in the environment', () => {
    expect(resolveGoogleOAuthConfig({ ...COMPLETE, NODE_ENV: 'production' }).config).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })
  })
})

/** The half that is missing, and an environment holding only the other half. */
const HALVES: [string, Record<string, string | undefined>][] = [
  ['GOOGLE_CLIENT_SECRET', { GOOGLE_CLIENT_ID: COMPLETE.GOOGLE_CLIENT_ID }],
  ['GOOGLE_CLIENT_SECRET', { ...COMPLETE, GOOGLE_CLIENT_SECRET: '  ' }],
  ['GOOGLE_CLIENT_ID', { GOOGLE_CLIENT_SECRET: COMPLETE.GOOGLE_CLIENT_SECRET }],
  ['GOOGLE_CLIENT_ID', { ...COMPLETE, GOOGLE_CLIENT_ID: '' }],
]

describe('when only one of them is set', () => {
  it.each(HALVES)(
    'names %s, so the boot failure says which half is missing (F9)',
    (variable, source) => {
      expect(offenders(source)).toEqual([variable])
    },
  )

  it('refuses to hand back a half configuration', () => {
    // Returning the id alone would let the process start and turn the mistake
    // into a failed sign-in for a person, rather than a refusal an operator sees.
    expect(resolveGoogleOAuthConfig({ GOOGLE_CLIENT_ID: 'client-id' }).config).toBeNull()
  })
})

describe('what an issue is allowed to say', () => {
  it('never quotes the value, because one of these two is a secret', () => {
    const secret = 'the-secret-half-of-the-pair'
    const { issues } = resolveGoogleOAuthConfig({ GOOGLE_CLIENT_SECRET: secret })

    // Issues are printed at boot and boot logs are kept by the platform, so a
    // reason that quoted its value would publish the credential it complains about.
    expect(issues).not.toEqual([])
    expect(JSON.stringify(issues)).not.toContain(secret)
  })
})
