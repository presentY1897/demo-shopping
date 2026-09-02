import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

/** Only the repository root carries this file, so it identifies the root. */
const ROOT_MARKER = 'pnpm-workspace.yaml'

/** Env files the API reads, lowest priority last — see {@link loadEnvFiles}. */
const ENV_FILES = ['.env.local', '.env'] as const

function defaultStartDir(): string {
  // `__dirname` is undefined when this module is loaded by an ESM-only runner;
  // the working directory is a good enough starting point in that case.
  return typeof __dirname === 'string' ? __dirname : process.cwd()
}

/**
 * Walks up from `startDir` looking for the workspace root.
 *
 * Returns `null` when there is none, which is the normal situation for a
 * deployed build: a container ships `dist/` alone, has no `.env` file and no
 * `PORT_OFFSET`, and is expected to receive every variable from the platform.
 */
export function findRepoRoot(startDir: string = defaultStartDir()): string | null {
  const { root } = parse(startDir)
  let current = startDir

  for (;;) {
    if (existsSync(join(current, ROOT_MARKER))) return current
    if (current === root) return null
    current = dirname(current)
  }
}

/**
 * Loads the repository's env files into `process.env` and returns the ones that
 * existed.
 *
 * `.env.local` is read first on purpose: `process.loadEnvFile` never overwrites
 * a variable that is already set, so the first file to define a name wins and a
 * value exported in the shell beats both files. That ordering is what makes
 * `PORT_OFFSET=50 pnpm --filter @shopping/api dev` work without editing a file.
 */
export function loadEnvFiles(repoRoot: string): readonly string[] {
  const loaded: string[] = []

  for (const name of ENV_FILES) {
    const file = join(repoRoot, name)
    if (!existsSync(file)) continue

    process.loadEnvFile(file)
    loaded.push(name)
  }

  return loaded
}
