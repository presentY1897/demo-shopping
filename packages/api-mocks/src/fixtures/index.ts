/**
 * Every fixture in the package, re-exported.
 *
 * `registry.ts` derives the C2 list from this barrel, and `registry.spec.ts`
 * walks `src/fixtures` on disk to prove the barrel is complete — a fixture file
 * nobody wired up is caught rather than silently unchecked.
 */

export * from './admin-sellers'
export * from './attributes'
export * from './categories'
export * from './demo'
export * from './health'
export * from './products'
export * from './sellers'
export * from './profile'
export * from './session'
export * from './user-roles'
