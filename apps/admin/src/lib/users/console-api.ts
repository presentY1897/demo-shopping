import type {
  AdjustPointsRequest,
  AdjustPointsResponse,
  AdminUserDetailResponse,
  AdminUserListQueryParams,
  AdminUserListResponse,
  GrantRoleRequest,
  Role,
  SuspendUserRequest,
  UserRolesResponse,
  ViewUserRequest,
} from '@shopping/shared'
import {
  adjustPointsResponseSchema,
  adminUserDetailResponseSchema,
  adminUserListResponseSchema,
  userRolesResponseSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { getApiClient } from '@/lib/api'

/**
 * 이 콘솔이 회원에 대해 두드리는 자리, 한 곳에 (TASK-0093).
 *
 * `lib/reports/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가
 * 필드 이름을 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를
 * 그리는 대신에 (게이트 C1).
 *
 * ## 역할만 `/admin` 아래에 없다
 *
 * `POST /users/:id/roles` 다. 관리 작업인데도 `/admin` 밖에 있는 이유를 그쪽
 * 컨트롤러가 적어 두었다 — **누가 부를 수 있는지는 퍼미션 표가 정하지 URL 이 정하지
 * 않는다** (`user-roles.controller.ts`). 경로를 여기 한 번만 적어 두는 것이 그
 * 어긋남이 화면 곳곳으로 퍼지지 않게 하는 방법이다.
 *
 * ## 목록을 다시 읽는 문이 역할에도 있지만 여기 없다
 *
 * `GET /users/:id/roles` 는 부르지 않는다. 상세 응답이 이미 `roles` 를 싣고
 * (`adminUserDetailSchema`), 부여·회수도 **바뀐 뒤의 집합 전체**로 답한다. 부를 데가
 * 없는 함수를 미리 두면 다음 사람은 그것이 **왜** 안 불리는지를 먼저 알아내야 한다.
 */

/**
 * 몸통 없는 대답.
 *
 * 정지와 해제는 204 다. `createApiClient` 의 `readJson` 이 빈 몸통을 `undefined` 로
 * 돌려주므로 **그것이 이 응답의 실제 모양**이고, 아무 스키마나 넘겨 놓으면 파싱이
 * 조용히 실패한다 — 스키마는 생략할 수 있는 인자가 아니다.
 */
const noContentSchema = z.undefined()

/** `?q=hong&role=SELLER_OWNER&isDemo=false&cursor=…`, 아무것도 없으면 빈 문자열. */
export function userSearch(query: AdminUserListQueryParams): string {
  const params = new URLSearchParams()

  if (query.q !== undefined) params.set('q', query.q)
  if (query.role !== undefined) params.set('role', query.role)
  // 참·거짓은 **문자열로** 실린다. 서버가 `'true'` 하나만 참으로 읽으므로
  // (`admin-user.controller.ts` 의 `readQuery`), 여기서 그 문법을 지킨다.
  if (query.isDemo !== undefined) params.set('isDemo', String(query.isDemo))
  if (query.suspended !== undefined) params.set('suspended', String(query.suspended))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 한 페이지. **가려진 값만 온다** (F6).
 *
 * 검색은 원본을 찾지만 답은 가려져 있다(`adminUserSummarySchema`) — 이 비대칭이
 * 설계다. 화면은 가리지도 않고 되돌리지도 않는다: 가리는 일이 서버의 것이라야 한
 * 화면이 잊는 날 그 화면만 전부 보여 주는 일이 생기지 않는다 (4.2).
 */
export function fetchUsers(
  query: AdminUserListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<AdminUserListResponse> {
  return getApiClient().request({
    path: `/admin/users${userSearch(query)}`,
    schema: adminUserListResponseSchema,
    ...options,
  })
}

/**
 * 가리지 않은 값을 연다 — **읽기인데 `POST` 다** (F7).
 *
 * 사유를 몸통으로 받아야 하기 때문이고, 질의 문자열에 실으면 개인정보를 여는 이유가
 * 접근 로그와 브라우저 기록에 그대로 남는다. 그리고 이 요청은 **부수효과가 있다** —
 * 열람 기록 한 줄을 만든다. `GET` 이 그러면 프리페치나 재시도가 조용히 기록을 늘린다
 * (4.3 · `admin-user.controller.ts`).
 *
 * 그래서 이 함수에는 캐시도 재시도도 없다. 부르는 쪽은 **사람이 사유를 적고 누른
 * 순간** 하나뿐이다.
 */
export function viewUser(userId: string, reason: string): Promise<AdminUserDetailResponse> {
  const body: ViewUserRequest = { reason }

  return getApiClient().request({
    path: `/admin/users/${userId}/views`,
    method: 'POST',
    body,
    schema: adminUserDetailResponseSchema,
  })
}

/** 정지 (F4). 사유가 필수다 — 사유 없는 정지는 **해제할 근거도 없다.** */
export function suspendUser(userId: string, reason: string): Promise<undefined> {
  const body: SuspendUserRequest = { reason }

  return getApiClient().request({
    path: `/admin/users/${userId}/suspension`,
    method: 'POST',
    body,
    schema: noContentSchema,
  })
}

/**
 * 정지를 푼다 (F4).
 *
 * 사유를 받지 않는다 — 계약이 그렇게 정해 두었다. 되돌리는 쪽에는 **되돌린다는 사실
 * 자체가 근거**이고, 정지 때 적힌 사유가 그 자리에 남아 무엇을 되돌렸는지 말한다.
 */
export function reinstateUser(userId: string): Promise<undefined> {
  return getApiClient().request({
    path: `/admin/users/${userId}/suspension`,
    method: 'DELETE',
    schema: noContentSchema,
  })
}

/**
 * 적립금 수동 조정 (F5).
 *
 * 지급과 차감이 **한 문**이다. 사람이 하는 조정에서 두 방향은 같은 판단이고, 문을
 * 둘로 나누면 화면이 부호를 보고 어느 쪽을 부를지 정하게 된다 — 그 분기가 틀리면
 * 더하려던 것이 빠진다 (4.5).
 *
 * 답의 `applied` 는 **실제로 움직인 몫**이다. 잔액보다 큰 차감은 잔액까지만 가므로,
 * 화면은 요청한 숫자가 아니라 이 값을 말해야 한다 (`pointsOutcome`).
 */
export function adjustPoints(
  userId: string,
  request: AdjustPointsRequest,
): Promise<AdjustPointsResponse> {
  return getApiClient().request({
    path: `/admin/users/${userId}/points`,
    method: 'POST',
    body: request,
    schema: adjustPointsResponseSchema,
  })
}

/** 역할 부여 (F3). 답은 **바뀐 뒤의 집합 전체**라 화면이 다시 묻지 않는다. */
export function grantRole(userId: string, role: Role): Promise<UserRolesResponse> {
  const body: GrantRoleRequest = { role }

  return getApiClient().request({
    path: `/users/${userId}/roles`,
    method: 'POST',
    body,
    schema: userRolesResponseSchema,
  })
}

/** 역할 회수 (F3). 역할이 **경로에** 실린다 (`user-roles.controller.ts`). */
export function revokeRole(userId: string, role: Role): Promise<UserRolesResponse> {
  return getApiClient().request({
    path: `/users/${userId}/roles/${role}`,
    method: 'DELETE',
    schema: userRolesResponseSchema,
  })
}
