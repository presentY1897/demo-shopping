import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { findRepoRoot, loadEnvFiles } from '../../src/config/workspace.js'

/**
 * The Meilisearch this worktree runs.
 *
 * **Not `localhost:7700`.** The port comes from `PORT_OFFSET`, so a spec that
 * hardcoded the default would talk to *another worktree's* engine — writing
 * documents into a catalogue somebody else is asserting against, which is the
 * interference the per-worktree offsets exist to make impossible.
 *
 * The port is asked of `scripts/ports.mjs`, which is that single source, rather
 * than recomputed here. Synchronously, because a spec file cannot `await` at the
 * top level (the package is CommonJS) and the host has to be known before
 * `useApiApp` is configured.
 *
 * `testAppConfig` points every other spec at a closed port on purpose: a suite
 * that reached a real engine by accident would pass or fail by whether one
 * happened to be running. A spec that *wants* the engine asks for it here — and
 * then requires it, the same way every integration spec requires Postgres.
 */
/** The key that engine wants, from the same `.env` the API reads. */
export function searchKeyForTests(): string {
  const repoRoot = findRepoRoot()

  if (repoRoot !== null) loadEnvFiles(repoRoot)

  return process.env.MEILI_MASTER_KEY ?? ''
}

export function searchHostForTests(): string {
  const configured = process.env.MEILI_HOST

  if (configured !== undefined && configured.trim() !== '') return configured

  const repoRoot = findRepoRoot()

  if (repoRoot === null) return 'http://localhost:7700'

  loadEnvFiles(repoRoot)

  const port = execFileSync(
    process.execPath,
    [join(repoRoot, 'scripts/ports.mjs'), '--port', 'meilisearch'],
    { encoding: 'utf8', cwd: repoRoot },
  ).trim()

  return `http://localhost:${port}`
}
