#!/usr/bin/env node

/**
 * 앱마다 **모든 화면이 공통으로 받는 JS** 가 예산 안인가 (TASK-0097 F6).
 *
 * ## 무엇을 세는가
 *
 * `build-manifest.json` 의 `polyfillFiles` + `rootMainFiles` 를 gzip 해서 더한다.
 * 이것이 **어느 화면을 열든 반드시 내려가는 바이트**이고, 화면별 청크는 그 위에
 * 얹힌다. 예산이 겨누는 것이 바로 이 공통분이다 — 화면 하나가 무거운 것은 그 화면의
 * 문제지만, 공통분이 무거우면 **모든 화면이** 무겁다.
 *
 * ## 왜 빌드 출력을 안 읽는가
 *
 * 이 Next 버전은 크기를 출력하지 않는다(Turbopack). 그래서 매니페스트를 직접 읽는다 —
 * 파일이 없거나 모양이 바뀌면 **던진다.** 조용히 0을 답하면 예산이 통과하고, 그때부터
 * 이 게이트는 있으나 마나다.
 */

import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** gzip 기준. 브라우저가 실제로 받는 바이트가 그것이다. */
const BUDGET_BYTES = 200 * 1024

const apps = ['shop', 'seller', 'admin']

function sharedBytes(app) {
  const root = join('apps', app, '.next')
  const manifestPath = join(root, 'build-manifest.json')

  let manifest

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`${manifestPath} 를 읽지 못했습니다. 먼저 빌드하세요.`, { cause: error })
  }

  const files = [...(manifest.polyfillFiles ?? []), ...(manifest.rootMainFiles ?? [])]

  if (files.length === 0) {
    throw new Error(`${app}: 공통 청크를 하나도 찾지 못했습니다 — 매니페스트 모양이 바뀌었습니다.`)
  }

  return files.reduce((total, file) => total + gzipSync(readFileSync(join(root, file))).length, 0)
}

const rows = apps.map((app) => ({ app, bytes: sharedBytes(app) }))
const over = rows.filter((row) => row.bytes > BUDGET_BYTES)

for (const row of rows) {
  const kb = (row.bytes / 1024).toFixed(1)
  const mark = row.bytes > BUDGET_BYTES ? '초과' : 'ok'

  process.stdout.write(`${row.app.padEnd(8)} ${kb.padStart(7)} KB gz  ${mark}\n`)
}

process.stdout.write(`예산 ${String(BUDGET_BYTES / 1024)} KB gz (공통 청크)\n`)

if (over.length > 0) {
  process.stderr.write(`\n예산을 넘은 앱: ${over.map((row) => row.app).join(', ')}\n`)
  process.exit(1)
}
