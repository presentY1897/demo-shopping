/**
 * 대시보드가 **어느 문을 두드리는가** (TASK-0092).
 *
 * 화면 검사는 `lib/dashboard/console-api` 를 통째로 대신 세운다(그 이유는
 * `support/dashboard.ts` 가 적고 있다). 그러면 경로 문자열은 아무도 안 읽게 되고,
 * `/admin/dashboard/metircs` 같은 오타는 **검사가 전부 초록인 채로** 배포된다. 여기서
 * 재는 것이 그것이다 — 세 경로와, 기간이 질의 문자열로 어떻게 나가는가.
 *
 * `@shopping/api-mocks` 가 아니라 `@/lib/api` 를 세운다. msw 대역이 없는 라우트라
 * 네트워크까지 갈 수 없고, 여기서 알고 싶은 것은 응답이 아니라 **요청**이다.
 */

import type { ApiClient, ApiRequestOptions } from '@shopping/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dashboardSearch,
  fetchDashboardMetrics,
  fetchDashboardPending,
  fetchDashboardSystem,
} from '@/lib/dashboard/console-api'

import { dashboardMetrics, dashboardPending, dashboardSystem } from './support/dashboard'

const requests: ApiRequestOptions<unknown>[] = []

/** 다음 요청이 받을 답. 스키마를 지나므로 계약과 어긋나면 여기서 깨진다. */
let answer: unknown = null

const client = {
  request: vi.fn((options: ApiRequestOptions<unknown>) => {
    requests.push(options)

    return Promise.resolve(options.schema.parse(answer))
  }),
} as unknown as ApiClient

vi.mock('@/lib/api', () => ({ getApiClient: () => client }))

beforeEach(() => {
  requests.length = 0
})

describe('the three doors', () => {
  it('sends both ends of the period to the metrics door', async () => {
    answer = dashboardMetrics()

    await fetchDashboardMetrics({ from: '2026-08-08', to: '2026-09-06' })

    expect(requests[0]?.path).toBe('/admin/dashboard/metrics?from=2026-08-08&to=2026-09-06')
  })

  /** 기간을 받지 않는 문이다 — 질의 문자열이 붙으면 그것부터 잘못이다 (4.2). */
  it('asks the queue with no query string at all', async () => {
    answer = dashboardPending()

    await fetchDashboardPending()

    expect(requests[0]?.path).toBe('/admin/dashboard/pending')
  })

  it('asks the process, not the database, for the scheduler health', async () => {
    answer = dashboardSystem()

    await fetchDashboardSystem()

    expect(requests[0]?.path).toBe('/admin/dashboard/system')
  })

  /**
   * 세 문 다 **응답을 계약 스키마로 읽는다** (게이트 C1). 서버가 필드 이름을 바꾸면
   * 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를 그리는 대신에.
   */
  it('parses every answer through its contract schema', async () => {
    answer = dashboardPending()

    await fetchDashboardPending()

    expect(() => requests[0]?.schema.parse({ claims: 'many' })).toThrow()
  })

  it('escapes nothing it does not have to, so the URL stays readable', () => {
    expect(dashboardSearch({ from: '2026-01-01', to: '2026-01-31' })).toBe(
      '?from=2026-01-01&to=2026-01-31',
    )
  })
})
