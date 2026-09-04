'use client'

import type { AuthorizationSubject, Permission, ResourceOwnership } from '@shopping/shared'
import { authorizePermission, authorizeResource } from '@shopping/shared'
import { useMemo } from 'react'

import type { AuthMessages } from '@/messages'
import { messagesFor } from '@/messages'

import type { AuthState } from './auth-context'
import { useAuth } from './auth-context'

/**
 * `can` and `reason`, over the authorization table `apps/api` uses (TASK-0023).
 *
 * **Nothing here decides anything.** `authorizePermission` and
 * `authorizeResource` live in `@shopping/shared` and are the same functions
 * `PermissionGuard` and `assertResourceAccess` call. A second implementation in
 * the browser would drift within a milestone and produce the failure this design
 * exists to prevent: a button that looks alive and answers 403.
 *
 * What this adds is the two things a screen needs and a pure function cannot
 * give it — the subject, built from the session, and a Korean sentence for the
 * refusal, taken from the app's catalog and keyed by `DenialReason` so the
 * wording matches what the API puts in `details`.
 *
 * One of the three identical copies described in `lib/auth/session-client.ts`.
 */

export interface Authorization {
  /** False while the boot renewal is still in flight. */
  readonly ready: boolean
  readonly can: (permission: Permission) => boolean
  /** Why not, or `undefined` when the answer is yes. */
  readonly reason: (permission: Permission) => string | undefined
  /** The same question about one row, which is where `own` and `demo` bite. */
  readonly canOn: (permission: Permission, resource: ResourceOwnership) => boolean
  readonly reasonOn: (permission: Permission, resource: ResourceOwnership) => string | undefined
}

function decide(
  state: AuthState,
  subject: AuthorizationSubject | null,
  copy: AuthMessages,
  permission: Permission,
  resource?: ResourceOwnership,
): string | undefined {
  // Order matters. "Still checking" and "not signed in" are both refusals, and
  // both would otherwise come out as `missing_permission` — which reads as "your
  // role cannot do this" to somebody whose only problem is that they have not
  // signed in yet.
  if (state.status === 'checking') return copy.denials.checking
  if (subject === null) return copy.denials.signed_out

  const decision =
    resource === undefined
      ? authorizePermission(subject, permission)
      : authorizeResource(subject, permission, resource)

  return decision.allowed ? undefined : copy.denials[decision.reason]
}

export function useAuthorization(): Authorization {
  const { state, subject } = useAuth()
  const copy = messagesFor().auth

  return useMemo<Authorization>(() => {
    const why = (permission: Permission, resource?: ResourceOwnership): string | undefined =>
      decide(state, subject, copy, permission, resource)

    return {
      ready: state.status !== 'checking',
      can: (permission) => why(permission) === undefined,
      reason: (permission) => why(permission),
      canOn: (permission, resource) => why(permission, resource) === undefined,
      reasonOn: (permission, resource) => why(permission, resource),
    }
  }, [state, subject, copy])
}
