#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" — decides whether this project needs a build.
 *
 * Vercel's contract is inverted from a normal exit code: **0 means skip**, and
 * any non-zero means build. That reads backwards, so every `process.exit` below
 * names which one it is.
 *
 * Why this exists: without it every push builds all four Vercel projects. A pull
 * request touching only `apps/api` still burned four builds (TASK-0032 changed
 * 15 files, all under `apps/api`, and shop·seller·admin·ui all rebuilt), and the
 * Hobby plan's daily limit ran out. Deployments then failed for 24 hours.
 *
 * Usage in the Vercel dashboard — Settings → Git → Ignored Build Step:
 *
 *     node scripts/vercel-ignore.mjs apps/shop
 *     node scripts/vercel-ignore.mjs packages/ui      (the Storybook project)
 *
 * The path is the project's Root Directory.
 */

import { execFileSync } from 'node:child_process'

/**
 * Changes anywhere in here affect every project: the lockfile pins what all of
 * them install, `packages/*` is compiled into each app, and the root configs
 * decide how they build. Listing them explicitly is deliberate — a directory a
 * project does not consume must not force a rebuild, and the only way to keep
 * that true is to enumerate the ones that do.
 */
const SHARED = [
  'packages/',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'tsconfig.json',
  'scripts/',
]

const target = process.argv[2]

if (target === undefined || target === '') {
  // No argument means the dashboard command is wrong. Build rather than skip:
  // a needless build costs one deployment, a wrongly skipped one ships nothing
  // and looks like a successful deploy.
  console.error('usage: node scripts/vercel-ignore.mjs <root-directory>')
  process.exit(1) // build
}

/**
 * `VERCEL_GIT_PREVIOUS_SHA` is empty on a project's first deployment and on some
 * redeploys. Comparing against `HEAD^` then fails on a shallow clone, so the
 * absence of a usable base is treated as "cannot tell" → build.
 */
function changedFiles() {
  const base = process.env.VERCEL_GIT_PREVIOUS_SHA

  try {
    const range = base !== undefined && base !== '' ? `${base}..HEAD` : 'HEAD^..HEAD'
    return execFileSync('git', ['diff', '--name-only', range], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line !== '')
  } catch {
    return undefined
  }
}

const files = changedFiles()

if (files === undefined) {
  console.log('변경 목록을 읽지 못했습니다 — 안전하게 빌드합니다.')
  process.exit(1) // build
}

const prefixes = [`${target.replace(/\/$/, '')}/`, ...SHARED]
const hit = files.find((file) => prefixes.some((prefix) => file.startsWith(prefix)))

if (hit !== undefined) {
  console.log(`${hit} 이(가) ${target} 에 영향을 줍니다 — 빌드합니다.`)
  process.exit(1) // build
}

console.log(`${files.length}개 파일 중 ${target} 에 영향을 주는 것이 없습니다 — 건너뜁니다.`)
process.exit(0) // skip
