import type {
  ApiFailure,
  ReportListQueryParams,
  ReportStatus,
  ReportTargetType,
} from '@shopping/shared'

/**
 * 신고 화면의 순수 판단 — **무엇을 묻고, 거절을 어떻게 읽는가.**
 *
 * `lib/settlements/settlement-console.ts` 와 같은 자리에 같은 이유로 있다: 여기
 * 있는 것들은 **틀려도 조용하다.** 상태 묶음을 잘못 조립하면 화면은 「이 조건에
 * 신고가 없습니다」를 멀쩡히 그리고, 거절을 잘못 분류하면 데모 관리자가 받는 403 이
 * 「일시적인 문제가 생겼어요」로 나타나 몇 번이고 다시 눌리게 된다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/* ------------------------------------------------------------- 필터 -- */

/**
 * 목록이 고를 수 있는 다섯 묶음.
 *
 * 계약의 `status` 는 **목록**이고(`PENDING,HIDDEN`), 그래서 화면이 고르는 것은
 * 상태 하나가 아니라 **묶음 하나**일 수 있다. `HANDLED` 가 그 자리다 — 운영자가
 * 「끝난 것」을 볼 때 숨김·삭제·반려를 세 번 골라 보게 만들 이유가 없다.
 *
 * `Record` 로 잡아 두므로 계약에 상태가 하나 늘면 여기가 typecheck 에서 걸린다.
 */
export const reportScopes = ['PENDING', 'HANDLED', 'HIDDEN', 'REMOVED', 'REJECTED'] as const

export type ReportScope = (typeof reportScopes)[number]

const SCOPE_STATUSES: Readonly<Record<ReportScope, readonly ReportStatus[]>> = {
  PENDING: ['PENDING'],
  // 처리된 것 전부. 「아무 일도 안 한 것」이 아니라 **반려도 여기 들어온다.**
  HANDLED: ['HIDDEN', 'REMOVED', 'REJECTED'],
  HIDDEN: ['HIDDEN'],
  REMOVED: ['REMOVED'],
  REJECTED: ['REJECTED'],
}

/** 이 묶음이 뜻하는 상태들. 질의는 이것을 쉼표 하나로 잇는다. */
export function statusesOf(scope: ReportScope): readonly ReportStatus[] {
  return SCOPE_STATUSES[scope]
}

/** 목록 필터가 들고 있는 것. `null` 은 「전체」다. */
export interface ReportFilters {
  readonly scope: ReportScope | null
  readonly targetType: ReportTargetType | null
}

export const EMPTY_REPORT_FILTERS: ReportFilters = { scope: null, targetType: null }

/** 하나라도 좁혔는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function isNarrowed(filters: ReportFilters): boolean {
  return filters.scope !== null || filters.targetType !== null
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `status=undefined` 를 만들고, 서버는 그것을 잘못된 상태로
 * 읽어 400 으로 답한다 (`settlement-console.ts` 의 같은 규약).
 */
export function queryOf(filters: ReportFilters): ReportListQueryParams {
  return {
    ...(filters.scope === null ? {} : { status: [...statusesOf(filters.scope)] }),
    ...(filters.targetType === null ? {} : { targetType: filters.targetType }),
  }
}

/* ------------------------------------------------------------- 거절 -- */

/**
 * 처리가 거절됐을 때, **이 화면이 따로 할 말이 있는** 두 가지.
 *
 * `forbidden` — 이 계정으로는 이 대상을 처리할 수 없다 (F7 · D-058). 데모 관리자의
 * `content.moderate` 는 `demo` 로 좁혀져 있고, 실계정이 쓴 글은 그 스코프가 닿지
 * 않는다. 목록은 읽히므로 **어느 줄이 그런 줄인지 화면은 미리 알 수 없다** — 대상의
 * 주인이 누구인지가 목록에 실려 오지 않기 때문이다. 그래서 버튼을 미리 죽이는 대신
 * 거절을 문장으로 받는다. 카탈로그의 `FORBIDDEN` 은 「권한이 없어요」 한 줄이라, 왜
 * 어떤 줄은 되고 어떤 줄은 안 되는지를 말하지 못한다.
 *
 * `stale` — 다른 관리자가 먼저 처리했다. 다음 행동은 **목록을 다시 읽는 것**이지
 * 다시 누르는 것이 아니고, 그 차이를 말할 수 있는 것은 화면뿐이다.
 */
export const reportRefusals = ['forbidden', 'stale'] as const

export type ReportRefusal = (typeof reportRefusals)[number]

/**
 * 이 거절이 둘 중 하나인가, 아니면 **카탈로그에 맡길 보통의 실패**인가.
 *
 * `null` 이 「보통」이다. 그때 문장을 고르는 것은 `failureMessage` 이고, 그것이
 * 코드별 문장을 이미 전부 들고 있다 — 여기서 되풀이하면 카탈로그를 지나지 않은
 * 문장이 하나 생긴다.
 */
export function refusalOf(failure: ApiFailure): ReportRefusal | null {
  if (failure.kind !== 'http') return null
  if (failure.status === 403) return 'forbidden'

  return failure.code === 'REPORT_ALREADY_HANDLED' ? 'stale' : null
}
