/**
 * 회원 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가 실제로
 * 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로 통과한다
 * (게이트 C2). 목록의 줄에 `email` 이 없다는 것도 여기서 지켜진다 — 계약이 가려진
 * 값만 싣기 때문에, 원본을 넣으려 하면 스키마가 그것을 떨어뜨린다 (F6).
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/admin/users` 라우트들은 그 패키지에
 * 아직 등록되어 있지 않고, 이 TASK 는 `apps/admin` 밖을 고치지 않는다. 그래서 이
 * 화면의 검사는 `lib/users/console-api` 를 대신 세운다 — 경로와 스키마가 한 곳에 모여
 * 있는 것이 그것을 가능하게 한다 (`support/reports.ts` 와 같은 사정).
 */

import type {
  AdjustPointsResponse,
  AdminUserDetail,
  AdminUserDetailResponse,
  AdminUserListResponse,
  AdminUserSummary,
  Role,
  UserRolesResponse,
} from '@shopping/shared'
import {
  adjustPointsResponseSchema,
  adminUserDetailResponseSchema,
  adminUserListResponseSchema,
  adminUserSummarySchema,
  userRolesResponseSchema,
} from '@shopping/shared'

let serial = 0

function nextId(prefix: string): string {
  serial += 1

  return `019596e0-${prefix}-7000-8000-${String(serial).padStart(12, '0')}`
}

/** 목록의 한 줄. 기본값은 아무 조치도 받지 않은 실계정 구매자다. */
export function userSummary(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return adminUserSummarySchema.parse({
    id: nextId('0041'),
    maskedEmail: 'hon***@example.com',
    maskedName: '홍*동',
    roles: ['BUYER'],
    isDemo: false,
    suspendedAt: null,
    createdAt: '2026-08-01T00:10:00.000Z',
    lastLoginAt: '2026-09-05T09:00:00.000Z',
    ...overrides,
  })
}

export function userList(
  users: readonly AdminUserSummary[],
  overrides: Partial<AdminUserListResponse> = {},
): AdminUserListResponse {
  return adminUserListResponseSchema.parse({ users, nextCursor: null, ...overrides })
}

/** 상세 한 건. **가려지지 않은 값**이 여기 있고, 그것을 받은 것이 곧 열람이다. */
export function userDetail(overrides: Partial<AdminUserDetail> = {}): AdminUserDetailResponse {
  return adminUserDetailResponseSchema.parse({
    user: {
      id: nextId('0042'),
      email: 'hongildong@example.com',
      name: '홍길동',
      roles: ['BUYER'],
      isDemo: false,
      suspendedAt: null,
      suspendedReason: null,
      createdAt: '2026-08-01T00:10:00.000Z',
      lastLoginAt: '2026-09-05T09:00:00.000Z',
      stats: {
        orderCount: 12,
        paidAmount: 348_000,
        reviewCount: 3,
        questionCount: 1,
        pointBalance: 12_000,
        couponCount: 2,
      },
      ...overrides,
    },
  })
}

/** 적립금 조정의 답. `applied` 는 **실제로 움직인 몫**이라 요청과 다를 수 있다. */
export function pointsAnswer(balance: number, applied: number): AdjustPointsResponse {
  return adjustPointsResponseSchema.parse({ balance, applied })
}

/** 역할 부여·회수의 답 — 바뀐 뒤의 집합 전체다. */
export function rolesAnswer(userId: string, roles: readonly Role[]): UserRolesResponse {
  return userRolesResponseSchema.parse({ userId, roles })
}
