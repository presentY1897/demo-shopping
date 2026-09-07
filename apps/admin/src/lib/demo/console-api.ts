import type {
  DemoAccountListResponse,
  DemoPolicy,
  DemoPolicyResponse,
  DemoStatsResponse,
} from '@shopping/shared'
import {
  demoAccountListResponseSchema,
  demoPolicyResponseSchema,
  demoStatsResponseSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { getApiClient } from '@/lib/api'

import type { DemoStatsPeriod } from './demo-console'

/**
 * 이 콘솔이 데모 관리에 대해 두드리는 자리, 한 곳에 (TASK-0096).
 *
 * `lib/dashboard/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다** (게이트 C1).
 *
 * **`demo-client.ts` 와 다른 파일이다.** 저쪽은 방문자가 데모 계정을 **받는** 문
 * 둘이고(`POST /auth/demo`), 이쪽은 운영자가 발급된 계정들을 **들여다보는** 문
 * 여섯이다. 한 파일에 담으면 `apps/shop` 과 `apps/seller` 에도 있는 저 파일이 이
 * 콘솔에서만 다른 모양이 된다.
 *
 * **문이 여섯인 것이 설계다.** 정책·계정·통계는 서로 다른 속도로 바뀌고 서로 다른
 * 이유로 실패한다 — 합치면 가장 느린 것이 나머지를 붙잡고, 하나가 실패하면 화면이
 * 통째로 빈다 (TASK-0092 4.1 과 같은 판단).
 */

/** 몸통 없는 대답. 강제 만료는 204 다 (`admin-console.controller.ts`). */
const noContentSchema = z.undefined()

/**
 * 지금 정책 (F6).
 *
 * 상수가 아니라 **행**이다 — `DEMO_ACCOUNT_TTL_HOURS` 로는 「수명을 1시간으로 바꿔
 * 본다」를 할 수 없고, 데모를 보여 주는 자리에서 필요한 것은 배포가 아니라 **지금
 * 바꾸는 일**이다 (4.4).
 */
export function fetchDemoPolicy(
  options: { readonly signal?: AbortSignal } = {},
): Promise<DemoPolicyResponse> {
  return getApiClient().request({
    path: '/admin/demo/policy',
    schema: demoPolicyResponseSchema,
    ...options,
  })
}

/**
 * 정책을 바꾼다 (F6).
 *
 * **이후 발급분에만 적용된다.** 이미 발급된 계정의 만료 시각을 소급해 옮기지 않는
 * 것이 서버의 판단이고(`admin-demo.service.ts`), 화면은 그 사실을 문장으로 말해야
 * 한다 — 말하지 않으면 운영자는 수명을 1시간으로 줄인 뒤 목록에서 24시간이 남은
 * 계정들을 보고 「안 먹혔다」고 읽는다.
 */
export function updateDemoPolicy(policy: DemoPolicy): Promise<DemoPolicyResponse> {
  return getApiClient().request({
    path: '/admin/demo/policy',
    method: 'PUT',
    body: policy,
    schema: demoPolicyResponseSchema,
  })
}

/** `?failedOnly=true&cursor=…`, 아무것도 없으면 빈 문자열. */
export function accountSearch(query: {
  readonly failedOnly?: boolean
  readonly cursor?: string
}): string {
  const params = new URLSearchParams()

  // 참·거짓은 문자열로 실린다 — 서버가 `'true'` 하나만 참으로 읽는다
  // (`admin-console.controller.ts` 의 `readQuery`).
  if (query.failedOnly !== undefined) params.set('failedOnly', String(query.failedOnly))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** 지금 살아 있는 데모 계정 한 페이지 (F1 · F4). 만료가 임박한 순으로 온다. */
export function fetchDemoAccounts(
  query: { readonly failedOnly?: boolean; readonly cursor?: string },
  options: { readonly signal?: AbortSignal } = {},
): Promise<DemoAccountListResponse> {
  return getApiClient().request({
    path: `/admin/demo/accounts${accountSearch(query)}`,
    schema: demoAccountListResponseSchema,
    ...options,
  })
}

/**
 * 강제 만료 (F2).
 *
 * **지우지 않는다.** 만료 시각을 지금으로 당겨 다음 정리가 평소의 경로로 집어 가게
 * 한다 — 지우는 순서는 표 하나에 데이터로 적혀 있고(`demo-cleanup-plan.ts`), 그
 * 순서를 두 곳에서 쓰면 외래키에 걸려 **절반만 지워진 계정**이 남는다 (4.1).
 *
 * 그래서 이 버튼을 누른 뒤에도 계정은 목록에 남아 있다. 화면이 그것을 말하지 않으면
 * 운영자는 실패로 읽는다.
 */
export function expireDemoAccount(userId: string): Promise<undefined> {
  return getApiClient().request({
    path: `/admin/demo/accounts/${userId}/expiry`,
    method: 'POST',
    schema: noContentSchema,
  })
}

/**
 * 지금 한 번 정리한다 (F5).
 *
 * 실패한 계정은 **만료된 채로 남아 있으므로** 다음 주기가 자동으로 다시 집는다
 * (`demo-cleanup.service.ts`). 이 문은 그 주기를 기다리지 않는 것이고, 그래서
 * 「재시도」와 「지금 정리」가 같은 버튼 하나다 (4.2).
 *
 * **응답 스키마가 `@shopping/shared` 에 없다.** 컨트롤러가 반환 타입을 손으로 적고
 * 있어(`sweep(): Promise<{ swept: number; failed: number }>`) 계약에서 가져올 것이
 * 없으므로, 그 모양을 여기 한 번 적는다. 게이트 C1 이 막으려는 것은 **응답 타입이
 * 앱마다 다시 선언되는 일**이고, 이것은 그 타입이 계약에 아직 없는 자리다.
 */
export const demoSweepResponseSchema = z.object({
  swept: z.int().min(0),
  failed: z.int().min(0),
})

export type DemoSweepResponse = z.infer<typeof demoSweepResponseSchema>

export function sweepDemoAccounts(): Promise<DemoSweepResponse> {
  return getApiClient().request({
    path: '/admin/demo/sweeps',
    method: 'POST',
    schema: demoSweepResponseSchema,
  })
}

/** `?from=2026-08-25&to=2026-09-07`. 기간은 언제나 둘 다 실려 나간다. */
export function statsSearch(period: DemoStatsPeriod): string {
  return `?${new URLSearchParams({ from: period.from, to: period.to }).toString()}`
}

/**
 * 발급 통계 (F7).
 *
 * 일별과 역할별을 **함께** 답한다 — 두 축을 따로 물으면 두 요청 사이에 발급이 일어나
 * 합이 안 맞는다 (4.5). 없던 날은 서버가 0으로 채워 보낸다.
 *
 * 기간을 **비워 보내지 않는다.** 서버에도 기본값이 있지만(최근 14일), 화면은 이미
 * 자기가 고른 기간을 날짜 두 칸에 그려 놓고 있다 — 비워 보내면 그 두 칸과 답이 서로
 * 다른 기간을 가리키게 되고, 그 어긋남은 자정 근처에서만 나타나 재현되지 않는다.
 */
export function fetchDemoStats(
  period: DemoStatsPeriod,
  options: { readonly signal?: AbortSignal } = {},
): Promise<DemoStatsResponse> {
  return getApiClient().request({
    path: `/admin/demo/stats${statsSearch(period)}`,
    schema: demoStatsResponseSchema,
    ...options,
  })
}
