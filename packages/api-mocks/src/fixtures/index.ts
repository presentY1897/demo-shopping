/**
 * Every fixture in the package, re-exported.
 *
 * `registry.ts` derives the C2 list from this barrel, and `registry.spec.ts`
 * walks `src/fixtures` on disk to prove the barrel is complete — a fixture file
 * nobody wired up is caught rather than silently unchecked.
 */

export * from './admin-sellers'
export * from './attributes'
export * from './cart'
export * from './categories'
export * from './checkout'
export * from './demo'
export * from './health'
export * from './orders'
export * from './payment'
export * from './products'
export * from './seller-console'
export * from './seller-orders'
export * from './sellers'
export * from './profile'
export * from './session'
export * from './user-roles'
