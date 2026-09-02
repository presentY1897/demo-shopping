import { firstSet, isBlank } from './env-value.js'

/**
 * Layers the values derived from `PORT_OFFSET` underneath the real environment.
 *
 * The precedence is the point of this function: an explicitly set variable is
 * never overwritten, so a managed database URL, a platform assigned port or a
 * one-off `MEILI_HOST=... pnpm dev` all keep working, while a `.env` copied
 * straight from `.env.example` needs no per worktree editing.
 */
export function mergeEnv(
  source: Readonly<Record<string, string | undefined>>,
  derived: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...source }

  // Render and Railway hand the process its port as `PORT`; `API_PORT` wins so
  // that a local override is still possible on a platform that sets both.
  const port = firstSet(source.API_PORT, source.PORT)
  if (port !== undefined) merged.API_PORT = port

  for (const [name, value] of Object.entries(derived)) {
    if (isBlank(merged[name])) merged[name] = value
  }

  return merged
}
