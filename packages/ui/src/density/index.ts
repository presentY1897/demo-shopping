/**
 * Density, including the React pieces. Import from here in a client tree:
 *
 *   import { DensityProvider, useDensity } from '@shopping/ui/density'
 *
 * A server component that only needs a constant (the console apps pinning
 * themselves to `CONSOLE_DENSITY`) imports from `@shopping/ui` instead, which
 * carries no React at all.
 */

export * from './density'
export * from './density-store'
export { DensityProvider, useDensity } from './density-context'
export type { DensityContextValue, DensityProviderProps } from './density-context'
export { DensityScript, densityBootScript } from './density-script'
