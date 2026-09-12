/**
 * 세 앱과 API 의 주소 (TASK-0099).
 *
 * **포트는 이 저장소에 한 벌뿐이다** — `scripts/ports.mjs` 가 `PORT_OFFSET` 에서
 * 전부를 계산한다. 워크트리를 여럿 띄워 두고 개발하는 저장소라 고정 포트는 두 번째
 * 워크트리에서 곧바로 깨진다. 여기서 숫자를 다시 적으면 그 계산이 두 벌이 된다.
 */

import { loadLocalEnv, resolvePorts } from '../../scripts/ports.mjs'

loadLocalEnv()

const ports = resolvePorts()

export const isCi = process.env.CI === 'true' || process.env.CI === '1'

export const APPS = {
  shop: process.env.E2E_SHOP_URL ?? `http://localhost:${String(ports.shop)}`,
  seller: process.env.E2E_SELLER_URL ?? `http://localhost:${String(ports.seller)}`,
  admin: process.env.E2E_ADMIN_URL ?? `http://localhost:${String(ports.admin)}`,
  api: process.env.E2E_API_URL ?? `http://localhost:${String(ports.api)}/api/v1`,
} as const

export type AppName = keyof typeof APPS

/**
 * 스택이 살아 있는지 확인하고, 없으면 **무엇을 띄워야 하는지** 말한다.
 *
 * Playwright 의 기본 실패 메시지는 「타임아웃」이고, 그것을 처음 보는 사람은 자기
 * 코드를 의심한다. 여기서 먼저 걸러 주면 다음 줄이 곧바로 답이 된다.
 */
export async function requireStack(): Promise<void> {
  const missing: string[] = []

  await Promise.all(
    (Object.keys(APPS) as AppName[]).map(async (name) => {
      const url = name === 'api' ? `${APPS.api}/health` : APPS[name]

      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) })

        if (!response.ok) missing.push(`${name} (${String(response.status)})`)
      } catch {
        missing.push(`${name} (응답 없음)`)
      }
    }),
  )

  if (missing.length > 0) {
    throw new Error(
      [
        `스택이 준비되지 않았습니다: ${missing.join(', ')}`,
        '',
        '로컬에서는 다음 순서입니다:',
        '  pnpm infra:up && pnpm db:deploy && pnpm db:seed && pnpm search:reindex',
        '  pnpm build && pnpm -r --parallel --if-present start',
      ].join('\n'),
    )
  }
}
