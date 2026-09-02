import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

function defaultStartDir(): string {
  return typeof __dirname === 'string' ? __dirname : process.cwd()
}

/**
 * Reads `version` from the nearest `package.json`.
 *
 * Walking up works from `src/` and from `dist/` alike, which is why the version
 * is not baked in at build time: `apps/api/package.json` is the only place it
 * is written down.
 */
export function readPackageVersion(startDir: string = defaultStartDir()): string | null {
  const { root } = parse(startDir)
  let current = startDir

  for (;;) {
    const file = join(current, 'package.json')

    if (existsSync(file)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
          const { version } = parsed
          if (typeof version === 'string' && version !== '') return version
        }
      } catch {
        return null
      }
      return null
    }

    if (current === root) return null
    current = dirname(current)
  }
}
