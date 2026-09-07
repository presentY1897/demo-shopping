/**
 * 데모 관리 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다** (게이트 C2 — `support/users.ts` 와 같은 사정).
 * 정리 실패의 시각과 이유가 짝이라는 것은 데이터베이스가 지키지만
 * (`User_demo_cleanup_failure_check`), 계약은 둘을 따로 nullable 로 싣는다. 그래서
 * 이 파일은 한쪽만 채운 값도 만들 수 있고, `cleanupFailureOf` 가 그것을 어떻게 읽는지가
 * 검사의 대상이다.
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/admin/demo` 라우트들은 그 패키지에
 * 아직 등록되어 있지 않으므로 `lib/demo/console-api` 를 대신 세운다.
 */

import type {
  AdminDemoAccount,
  DemoAccountListResponse,
  DemoPolicy,
  DemoPolicyResponse,
  DemoStatsResponse,
} from '@shopping/shared'
import {
  adminDemoAccountSchema,
  demoAccountListResponseSchema,
  demoPolicyResponseSchema,
  demoStatsResponseSchema,
} from '@shopping/shared'

/** 검사가 시각을 고정해서 쓴다 — 만료 판정은 「지금」에 대한 것이라 흘러가면 안 된다. */
export const DEMO_NOW = new Date('2026-09-07T03:00:00.000Z')

let serial = 0

function nextId(): string {
  serial += 1

  return `019596e0-0051-7000-8000-${String(serial).padStart(12, '0')}`
}

/** 데모 계정 한 줄. 기본값은 아직 여섯 시간 남은 구매자 계정이다. */
export function demoAccount(overrides: Partial<AdminDemoAccount> = {}): AdminDemoAccount {
  return adminDemoAccountSchema.parse({
    userId: nextId(),
    roles: ['BUYER'],
    createdAt: '2026-09-06T21:00:00.000Z',
    expiresAt: '2026-09-07T09:00:00.000Z',
    cleanupError: null,
    cleanupFailedAt: null,
    ...overrides,
  })
}

export function demoAccountList(
  accounts: readonly AdminDemoAccount[],
  overrides: Partial<DemoAccountListResponse> = {},
): DemoAccountListResponse {
  return demoAccountListResponseSchema.parse({ accounts, nextCursor: null, ...overrides })
}

export function demoPolicy(overrides: Partial<DemoPolicy> = {}): DemoPolicyResponse {
  return demoPolicyResponseSchema.parse({
    policy: { ttlHours: 24, seedOrders: 3, virtualCardLimit: 5_000_000, ...overrides },
  })
}

export function demoStats(overrides: Partial<DemoStatsResponse> = {}): DemoStatsResponse {
  return demoStatsResponseSchema.parse({
    // 없던 날은 서버가 0으로 채워 보낸다 (4.5). 대역도 그렇게 답한다.
    days: [
      { date: '2026-09-05', issued: 2 },
      { date: '2026-09-06', issued: 0 },
      { date: '2026-09-07', issued: 5 },
    ],
    byRole: { BUYER: 5, SELLER_OWNER: 2 },
    activeAccounts: 7,
    failedCleanups: 1,
    ...overrides,
  })
}
