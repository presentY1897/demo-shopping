import { SetMetadata } from '@nestjs/common'
import type { Permission } from '@shopping/shared'

/** Metadata key holding the permission an endpoint requires. */
export const REQUIRED_PERMISSION = Symbol('REQUIRED_PERMISSION')

/**
 * Declares the permission a handler needs.
 *
 * One permission per endpoint, never a list: "either of these two" hides which
 * capability an endpoint really represents, and the generated matrix stops
 * being readable. An endpoint that seems to need two is usually two endpoints.
 *
 * Declaring nothing is not a way to leave an endpoint open — see
 * {@link PermissionGuard}. Open endpoints say so with `@PublicEndpoint()`.
 */
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION, permission)
