/**
 * The React-free surface of `@shopping/ui`.
 *
 * Kept apart from `@shopping/ui/density` so that a server component — a console
 * root layout that needs nothing but `CONSOLE_DENSITY` — does not pull a
 * `'use client'` module, and the React bundle it implies, into its graph.
 */

export const UI_PACKAGE_NAME = '@shopping/ui'

export * from './density/density'
