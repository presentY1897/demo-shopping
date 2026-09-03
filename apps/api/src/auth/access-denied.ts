import { ForbiddenException } from '@nestjs/common'
import type {
  AuthorizationSubject,
  DenialReason,
  Permission,
  ResourceOwnership,
} from '@shopping/shared'
import { authorizeResource } from '@shopping/shared'

/**
 * Why the request was refused, in Korean, for the `details` of the shared error
 * envelope.
 *
 * The envelope's own 403 message stays generic ("이 작업을 수행할 권한이
 * 없습니다."); this names the permission so that a console can explain the
 * disabled button instead of just greying it out (TASK-0023).
 */
const REASON_MESSAGE: Readonly<Record<DenialReason, (permission: Permission) => string>> = {
  missing_permission: (permission) => `${permission} 퍼미션이 없습니다.`,
  out_of_scope: (permission) => `${permission} 퍼미션으로 접근할 수 없는 리소스입니다.`,
}

/**
 * A 403 in the shared envelope.
 *
 * `ForbiddenException` with a string payload lands in `details` as one entry —
 * `AllExceptionsFilter` copies strings only, so nothing internal can leak
 * through here by accident.
 */
export function accessDenied(permission: Permission, reason: DenialReason): ForbiddenException {
  return new ForbiddenException(REASON_MESSAGE[reason](permission))
}

/**
 * The one scope check every service calls (TASK-0105 R2).
 *
 * Services load their row, ask this, and are done: no service decides what
 * `own` or `demo` means, and none of them ever reads a demo flag. Keeping the
 * decision in `@shopping/shared` and the throwing here is what lets the same
 * rules be evaluated in a browser by a permission hook that must not throw.
 */
export function assertResourceAccess(
  subject: AuthorizationSubject,
  permission: Permission,
  resource: ResourceOwnership,
): void {
  const decision = authorizeResource(subject, permission, resource)

  if (!decision.allowed) throw accessDenied(permission, decision.reason)
}
