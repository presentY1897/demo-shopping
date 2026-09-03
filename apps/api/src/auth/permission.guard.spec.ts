import type { IncomingMessage } from 'node:http'

import type { ExecutionContext } from '@nestjs/common'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it, vi } from 'vitest'

import { PermissionGuard } from './permission.guard.js'
import type { PrincipalResolver } from './principal-resolver.js'
import { PublicEndpoint } from './public-endpoint.decorator.js'
import { RequirePermission } from './require-permission.decorator.js'
import type { RequestPrincipal } from './request-principal.js'
import { principalOf } from './request-principal.js'

class Handlers {
  @RequirePermission('product.write')
  guarded(): string {
    return 'guarded'
  }

  @PublicEndpoint()
  open(): string {
    return 'open'
  }

  /** Deliberately undecorated — the case deny-by-default exists for. */
  undeclared(): string {
    return 'undeclared'
  }

  @PublicEndpoint()
  @RequirePermission('product.write')
  contradictory(): string {
    return 'contradictory'
  }
}

@RequirePermission('catalog.write')
class GuardedController {
  inherited(): string {
    return 'inherited'
  }
}

/**
 * Reads a handler off the prototype without going through a member expression,
 * which is what `@typescript-eslint/unbound-method` objects to — and rightly so
 * everywhere except here, where the unbound function *is* the subject.
 */
function handlerOf(controller: { prototype: object }, name: string): () => void {
  const method = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value as unknown

  if (typeof method !== 'function') throw new Error(`${name} 핸들러를 찾지 못했습니다.`)

  return method as () => void
}

function principal(overrides: Partial<RequestPrincipal> = {}): RequestPrincipal {
  return { userId: 'u-1', roles: ['ADMIN_SUPER'], sellerId: null, app: 'admin', ...overrides }
}

function contextFor(controller: object, handler: () => void): ExecutionContext {
  const request = { headers: {} } as IncomingMessage

  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

function requestOf(context: ExecutionContext): IncomingMessage {
  return context.switchToHttp().getRequest<IncomingMessage>()
}

function guardWith(resolved: RequestPrincipal | null): {
  guard: PermissionGuard
  resolve: PrincipalResolver['resolve']
} {
  const resolve = vi.fn(() => Promise.resolve(resolved))

  return { guard: new PermissionGuard(new Reflector(), { resolve }), resolve }
}

/** The `details` entry the shared error envelope will carry. */
function detailOf(error: unknown): unknown {
  if (!(error instanceof ForbiddenException) && !(error instanceof UnauthorizedException)) {
    throw error
  }

  const payload: unknown = error.getResponse()

  return typeof payload === 'object' && payload !== null && 'message' in payload
    ? payload.message
    : payload
}

describe('deny by default', () => {
  it('refuses a handler that declares nothing, even to a super admin', async () => {
    const { guard } = guardWith(principal())
    const context = contextFor(Handlers, handlerOf(Handlers, 'undeclared'))

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(guard.canActivate(context).catch(detailOf)).resolves.toBe(
      '엔드포인트에 퍼미션이 선언되지 않았습니다.',
    )
  })

  it('never asks the resolver for an undeclared handler', async () => {
    const { guard, resolve } = guardWith(principal())

    await expect(
      guard.canActivate(contextFor(Handlers, handlerOf(Handlers, 'undeclared'))),
    ).rejects.toThrow()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('refuses a handler that is both public and permission guarded', async () => {
    const { guard } = guardWith(principal())
    const context = contextFor(Handlers, handlerOf(Handlers, 'contradictory'))

    await expect(guard.canActivate(context).catch(detailOf)).resolves.toBe(
      '엔드포인트 권한 선언이 잘못되었습니다.',
    )
  })
})

describe('public endpoints', () => {
  it('lets an anonymous caller through', async () => {
    const { guard, resolve } = guardWith(null)

    await expect(
      guard.canActivate(contextFor(Handlers, handlerOf(Handlers, 'open'))),
    ).resolves.toBe(true)
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('guarded endpoints', () => {
  it('answers 401 while nobody could be identified', async () => {
    const { guard } = guardWith(null)

    await expect(
      guard.canActivate(contextFor(Handlers, handlerOf(Handlers, 'guarded'))),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('answers 403 naming the permission the caller lacks', async () => {
    const { guard } = guardWith(principal({ roles: ['BUYER'] }))
    const context = contextFor(Handlers, handlerOf(Handlers, 'guarded'))

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(guard.canActivate(context).catch(detailOf)).resolves.toBe(
      'product.write 퍼미션이 없습니다.',
    )
  })

  it('admits a caller who holds the permission at any scope', async () => {
    const { guard } = guardWith(principal({ roles: ['SELLER_OWNER'], sellerId: 'store-1' }))

    await expect(
      guard.canActivate(contextFor(Handlers, handlerOf(Handlers, 'guarded'))),
    ).resolves.toBe(true)
  })

  it('attaches the principal for the handler and the services below it', async () => {
    const caller = principal()
    const { guard } = guardWith(caller)
    const context = contextFor(Handlers, handlerOf(Handlers, 'guarded'))

    expect(principalOf(requestOf(context))).toBeNull()
    await guard.canActivate(context)
    expect(principalOf(requestOf(context))).toEqual(caller)
  })

  it('honours a permission declared on the controller class', async () => {
    const { guard } = guardWith(principal({ roles: ['ADMIN_OPERATOR'] }))

    await expect(
      guard.canActivate(contextFor(GuardedController, handlerOf(GuardedController, 'inherited'))),
    ).resolves.toBe(true)

    const { guard: buyer } = guardWith(principal({ roles: ['BUYER'] }))

    await expect(
      buyer.canActivate(contextFor(GuardedController, handlerOf(GuardedController, 'inherited'))),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
