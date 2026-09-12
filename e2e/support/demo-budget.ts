import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'
import { DEMO_ISSUE_LIMIT, DEMO_ISSUE_WINDOW_SECONDS } from '@shopping/shared'

import { APPS } from './apps.js'

// Timestamps only. Sharing this file preserves the budget across repeat workers.
const file = join(
  tmpdir(),
  `shopping-demo-batch-issues-${createHash('sha256').update(APPS.api).digest('hex').slice(0, 12)}.json`,
)
const windowMs = DEMO_ISSUE_WINDOW_SECONDS * 1000 + 5000

function recorded(): number[] {
  const values: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'number')) {
    throw new Error('데모 발급 시각 기록을 읽을 수 없습니다.')
  }
  return values
}

function serverTime(date: string | undefined): number {
  const parsed = Date.parse(date ?? '')
  if (!Number.isFinite(parsed)) throw new Error('API 응답의 서버 시각을 읽을 수 없습니다.')
  return parsed
}

export async function waitForDemoBudget(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await page.request.head(`${APPS.api}/health`)
        expect(response.ok()).toBeTruthy()
        const values = recorded()
        const expired = values.every((at) => at <= serverTime(response.headers().date) - windowMs)
        return expired ? 0 : values.length
      },
      {
        timeout: windowMs + 2000,
        intervals: [500, 1000],
        message: '서버의 데모 발급 창 안에서 다음 계정 발급을 기다립니다.',
      },
    )
    .toBeLessThan(DEMO_ISSUE_LIMIT)
}

export function recordDemoIssue(date: string | undefined): void {
  // HTTP dates have second precision; retain an issue through the next second.
  const now = serverTime(date) + 1000
  const values = recorded()
  const batch = values.length >= DEMO_ISSUE_LIMIT ? [] : values
  writeFileSync(file, JSON.stringify([...batch, now]), { mode: 0o600 })
}
