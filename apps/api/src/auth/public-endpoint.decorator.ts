import { SetMetadata } from '@nestjs/common'

/** Metadata key marking an endpoint as reachable without credentials. */
export const PUBLIC_ENDPOINT = Symbol('PUBLIC_ENDPOINT')

/**
 * Opens an endpoint to everyone, including anonymous callers.
 *
 * The counterpart to deny-by-default: because a handler that declares nothing is
 * blocked, "this one is genuinely public" has to be said out loud. That turns
 * the open surface of the API into a list a reviewer can grep for
 * (`docs/design/permission-matrix.md` covers the guarded half).
 */
export const PublicEndpoint = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ENDPOINT, true)
