import type { DynamicModule, Type } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { describe, expect, it } from 'vitest'

import { AppModule } from '../app.module.js'
import type { AppConfig } from '../config/app-config.js'
import { PUBLIC_ENDPOINT } from './public-endpoint.decorator.js'
import { REQUIRED_PERMISSION } from './require-permission.decorator.js'

/**
 * Gate F7 of TASK-0105: every endpoint in the application declares what it
 * needs.
 *
 * The guard already refuses an undeclared handler at runtime, but a 403 nobody
 * calls until production is a poor way to find out. This walks the module graph
 * statically — no DI container, no database, nothing to boot — and fails the
 * build instead.
 *
 * It reads `@Module` metadata rather than a running application on purpose: the
 * check must hold for a module that is registered but whose dependencies cannot
 * be constructed in CI.
 */

type ModuleEntry = Type<unknown> | DynamicModule

function isDynamic(entry: ModuleEntry): entry is DynamicModule {
  return typeof entry === 'object' && 'module' in entry
}

function metadataOf<T>(target: object, key: string): readonly T[] {
  return (Reflect.getMetadata(key, target) as readonly T[] | undefined) ?? []
}

/** Every controller reachable from the application's module graph. */
function controllersOf(root: ModuleEntry): readonly Type<unknown>[] {
  const seen = new Set<unknown>()
  const queue: ModuleEntry[] = [root]
  const controllers: Type<unknown>[] = []

  while (queue.length > 0) {
    const entry = queue.shift()
    if (entry === undefined) continue

    const key = isDynamic(entry) ? entry.module : entry
    if (seen.has(key)) continue
    seen.add(key)

    const imports = isDynamic(entry)
      ? (entry.imports ?? [])
      : metadataOf<ModuleEntry>(entry, 'imports')
    const declared = isDynamic(entry)
      ? (entry.controllers ?? [])
      : metadataOf<Type<unknown>>(entry, 'controllers')

    controllers.push(...declared)
    queue.push(...(imports as ModuleEntry[]))

    // A dynamic module's own class can carry static metadata too.
    if (isDynamic(entry) && typeof entry.module === 'function') {
      queue.push(...metadataOf<ModuleEntry>(entry.module, 'imports'))
      controllers.push(...metadataOf<Type<unknown>>(entry.module, 'controllers'))
    }
  }

  return controllers
}

interface Route {
  readonly name: string
  readonly declaresPermission: boolean
  readonly declaresPublic: boolean
}

/** A method is a route when Nest's HTTP decorators left their metadata on it. */
function routesOf(controller: Type<unknown>): readonly Route[] {
  const prototype = controller.prototype as object

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => Object.getOwnPropertyDescriptor(prototype, name)?.value as unknown)
    .filter((handler): handler is object => typeof handler === 'function')
    .filter(
      (handler) =>
        Reflect.getMetadata(PATH_METADATA, handler) !== undefined &&
        Reflect.getMetadata(METHOD_METADATA, handler) !== undefined,
    )
    .map((handler) => ({
      name: `${controller.name}.${(handler as { name: string }).name}`,
      declaresPermission:
        Reflect.getMetadata(REQUIRED_PERMISSION, handler) !== undefined ||
        Reflect.getMetadata(REQUIRED_PERMISSION, controller) !== undefined,
      declaresPublic:
        Reflect.getMetadata(PUBLIC_ENDPOINT, handler) === true ||
        Reflect.getMetadata(PUBLIC_ENDPOINT, controller) === true,
    }))
}

const routes = controllersOf(AppModule.forRoot({} as AppConfig)).flatMap((controller) =>
  routesOf(controller),
)

describe('endpoint permission coverage', () => {
  it('finds the endpoints of the application', () => {
    // A walk that silently found nothing would make every assertion below pass.
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.map((route) => route.name)).toContain('HealthController.check')
    // Reaches controllers in nested modules too, not just the first one found.
    expect(routes.map((route) => route.name)).toContain('UserRolesController.grant')
  })

  it('declares a permission or public access on every endpoint', () => {
    const undeclared = routes
      .filter((route) => !route.declaresPermission && !route.declaresPublic)
      .map((route) => route.name)

    expect(undeclared).toEqual([])
  })

  it('never declares both on one endpoint', () => {
    const contradictory = routes
      .filter((route) => route.declaresPermission && route.declaresPublic)
      .map((route) => route.name)

    expect(contradictory).toEqual([])
  })
})
