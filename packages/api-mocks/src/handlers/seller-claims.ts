import type { ClaimHandlingStage, ClaimStatus, SellerClaimListItem } from '@shopping/shared'
import {
  claimHandlingStages,
  claimTransitionRequestSchema,
  claimTransitionResponseSchema,
  inspectReturnRequestSchema,
  returnResponseSchema,
  SELLER_CLAIM_LIST_DEFAULT_LIMIT,
  sellerClaimDetailResponseSchema,
  sellerClaimListItemSchema,
  sellerClaimListQueryParamsSchema,
  sellerClaimListResponseSchema,
  sellerClaimSummaryResponseSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'
import type { MockSellerClaimRow } from './seller-claim-contract'
import {
  MOCK_SELLER_CLAIM_NOW,
  MOCK_SELLER_CLAIM_SELLER_STEPS,
  mockSellerClaimRowOf,
  mockSellerClaimSeeds,
  sellerClaimDetailOf,
  sellerClaimNeedsReason,
  sellerClaimStageOf,
  sellerClaimStageRank,
  sellerClaimSummaryOf,
  sellerReturnShipmentOf,
  sortSellerClaims,
} from './seller-claim-contract'

/**
 * 판매자 콘솔의 클레임 (TASK-0070), 화면이 물어보는 것만큼.
 *
 * **상태를 갖는다.** 이 화면이 묻는 질문이 전부 상태에 대한 것이기 때문이다 —
 * 승인하면 대기 뱃지가 줄어드는가, 수거를 시작하면 그 줄이 「회수 중」으로 옮겨
 * 가는가, 검수에서 떨어뜨리면 반송장이 나는가. 얼어붙은 픽스처는 그중 무엇에도
 * 답하지 못하고, 그것으로 검사한 화면은 틀린 일을 하면서 통과한다.
 *
 * 재현하는 것은 **화면이 HTTP 로 관찰할 수 있는 것**뿐이다.
 *
 * | 성질 | 실제 API 가 지키는 방법 |
 * | --- | --- |
 * | 처리 대기가 먼저 | `ORDER BY stage.rank ASC, c.id ASC` |
 * | 커서가 행이 아니라 **자리** | `base64url("<단계순위>.<uuid>")` |
 * | 뱃지는 필터를 보지 않는다 | 요약이 다른 라우트이고 질의를 받지 않는다 |
 * | 버튼과 문은 서버가 정한다 | `actionsFor(status)` + `claimActionRouteOf` |
 * | 거절에는 사유가 필수 | `CLAIM_REASON_REQUIRED` (전이는 `reason`, 검수는 `note`) |
 *
 * **커서의 인코딩이 서버의 것과 같아야 한다.** 여기서 갈리면 화면 검사만 통과하고
 * 실 서버 앞에서 첫 「다음」이 400 으로 끝난다 — 계약 게이트가 막으려는 것이 정확히
 * 그 종류의 통과다.
 *
 * **모든 응답이 `defineFixture` 를 지난다** — 계약과 어긋난 본문은 그것을 잘못 그릴
 * 화면이 아니라 여기서 실패한다 (C2).
 *
 * 씨앗과 조립기는 `seller-claim-contract.ts` 에 있다. 픽스처가 같은 것을 읽어야
 * 하고, 픽스처 파일은 픽스처 말고 아무것도 내보낼 수 없기 때문이다.
 */

let rows: MockSellerClaimRow[] = []

/** 다음 쓰기 하나를 실패시킨다 (승인·수거·검수 중 먼저 오는 것). */
let nextFailure: MockApiError | null = null

export function failNextSellerClaim(error?: MockApiError): void {
  nextFailure = error ?? new MockApiError(409, '지금은 처리할 수 없는 클레임입니다.')
}

/** 씨앗에서 저장소를 다시 만든다. `setupTestServer` 의 리셋이 부른다. */
export function resetSellerClaimStore(): void {
  nextFailure = null
  rows = mockSellerClaimSeeds.map(mockSellerClaimRowOf)
}

resetSellerClaimStore()

/** 저장소가 지금 들고 있는 것 — 검사가 「무엇을 했나」를 단언할 수 있게. */
export function sellerClaimSnapshot(): readonly SellerClaimListItem[] {
  return rows.map((row) => row.item)
}

function rowOf(id: string): MockSellerClaimRow {
  const row = rows.find((candidate) => candidate.claim.id === id)

  if (row === undefined) throw new MockApiError(404, '클레임을 찾을 수 없어요.')

  return row
}

/** 다음 쓰기를 실패시켜 두었으면 여기서 터진다. 한 번 쓰고 스스로 꺼진다. */
function refusingOnce(): void {
  if (nextFailure === null) return

  const failure = nextFailure

  nextFailure = null
  throw failure
}

/* --------------------------------------------------------------------------
 * 커서 — **불투명 문자열**이고, 인코딩이 서버의 것과 같아야 한다
 * ----------------------------------------------------------------------- */

/** 커서 문자열의 모양 — `<순위>.<uuid>` (`decodeSellerClaimCursor` 의 것 그대로). */
const CURSOR_PATTERN =
  /^(?<rank>\d)\.(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

interface SellerClaimCursor {
  readonly stageRank: number
  readonly id: string
}

/**
 * 자리를 커서로.
 *
 * base64url 로 감싸는 것은 **클라이언트가 해석하지 못하게** 하기 위해서다. 목이 날것
 * 문자열을 내보내면 화면은 그것을 읽는 코드를 갖게 되고, 그 코드는 실 서버 앞에서
 * 한 번도 맞지 않는다.
 */
function encodeCursor(cursor: SellerClaimCursor): string {
  return Buffer.from(`${String(cursor.stageRank)}.${cursor.id}`, 'utf8').toString('base64url')
}

/** 커서를 자리로. **모양이 아니면 `null`** 이고, 부르는 쪽이 400 으로 돌려보낸다. */
function decodeCursor(value: string): SellerClaimCursor | null {
  const groups = CURSOR_PATTERN.exec(Buffer.from(value, 'base64url').toString('utf8'))?.groups

  if (groups === undefined) return null

  const stageRank = Number(groups.rank)

  // 순위는 단계의 개수만큼만 있다. 범위를 벗어난 값은 정렬 축 위의 자리가 아니다.
  if (stageRank >= claimHandlingStages.length) return null

  return { stageRank, id: String(groups.id) }
}

/**
 * 커서가 없으면 `null`, 모양이 아니면 400.
 *
 * 조용히 첫 페이지로 되돌리지 않는다 — 그러면 커서가 깨진 화면이 「1페이지를 무한히
 * 반복」하고, 그 증상은 아무 오류도 내지 않는다.
 */
function cursorOf(value: string | undefined): SellerClaimCursor | null {
  if (value === undefined) return null

  const cursor = decodeCursor(value)

  if (cursor === null) {
    throw new MockApiError(400, '목록을 이어서 불러올 수 없어요.', {
      code: 'INVALID',
      field: 'cursor',
    })
  }

  return cursor
}

/** 이 줄이 커서가 가리키는 자리보다 **뒤에** 있는가 — `(순위, id) > (순위, id)`. */
function isAfter(item: SellerClaimListItem, cursor: SellerClaimCursor): boolean {
  const rank = sellerClaimStageRank(item.stage)

  return rank > cursor.stageRank || (rank === cursor.stageRank && item.id > cursor.id)
}

/* --------------------------------------------------------------------------
 * 전이 · 수거 · 검수
 * ----------------------------------------------------------------------- */

/** 사유가 실제로 적혔는가. `null` · 빈 문자열 · 공백만을 한 갈래로 접는다. */
function hasText(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value.trim() !== ''
}

/** 그 걸음이 정의되어 있는가. 판매자가 지날 수 있는 화살표만 목이 답한다. */
function assertStep(row: MockSellerClaimRow, to: ClaimStatus): void {
  if (MOCK_SELLER_CLAIM_SELLER_STEPS[row.claim.status].includes(to)) return

  throw new MockApiError(409, '지금 상태에서는 할 수 없는 요청이에요.', {
    code: 'CLAIM_TRANSITION_UNDEFINED',
    field: 'to',
    params: { from: row.claim.status, to },
  })
}

/** 반품 라우트를 취소 신청에 부른 것. 부른 사람이 고쳐야 하는 것은 **라우트**다. */
function returnOf(row: MockSellerClaimRow) {
  if (row.returnDetail === null) {
    throw new MockApiError(400, '반품 신청이 아니에요.', {
      code: 'CLAIM_TRANSITION_UNDEFINED',
      field: 'claimId',
    })
  }

  return row.returnDetail
}

/**
 * 상태를 옮기고 **목록 줄과 신청서를 함께** 새로 만든다.
 *
 * 갈리면 화면이 두 말을 한다 — 목록에는 「승인 대기」인데 상세에는 「승인됨」인
 * 상태가 그것이고, 실제 서버에서는 두 값이 한 행의 한 열이라 생길 수 없다.
 */
function moveTo(row: MockSellerClaimRow, to: ClaimStatus, reason: string | null): void {
  const from = row.claim.status
  const stage: ClaimHandlingStage = sellerClaimStageOf(to)

  row.item = defineFixture(sellerClaimListItemSchema, { ...row.item, status: to, stage })
  row.claim = {
    ...row.claim,
    status: to,
    updatedAt: MOCK_SELLER_CLAIM_NOW,
    // 상태를 옮기면 이력이 한 줄 자란다. **누가 그렇게 판단했나**가 이 줄의 값이라
    // 사유도 여기 붙는다 — 분쟁에서 읽히는 것이 이력이다.
    history: [
      ...row.claim.history,
      {
        id: `${row.claim.id.slice(0, 24)}fa${String(row.claim.history.length + 1).padStart(10, '0')}`,
        fromStatus: from,
        toStatus: to,
        reason,
        actor: 'SELLER',
        actorId: row.claim.requestedById,
        occurredAt: MOCK_SELLER_CLAIM_NOW,
      },
    ],
  }
}

function detailAnswer(row: MockSellerClaimRow): Response {
  return HttpResponse.json(defineFixture(sellerClaimDetailResponseSchema, sellerClaimDetailOf(row)))
}

/** 수거·검수의 답 — **클레임과 부속을 함께** 싣는다. 따로 부르면 두 순간을 본다. */
function returnAnswer(row: MockSellerClaimRow): Response {
  return HttpResponse.json(
    defineFixture(returnResponseSchema, { claim: row.claim, return: returnOf(row) }),
  )
}

export const sellerClaimHandlers: readonly RequestHandler[] = [
  /**
   * `GET /seller-claims/summary` — **`:id` 보다 먼저**.
   *
   * msw 는 먼저 맞는 것을 쓴다. 아래에 두면 `summary` 가 클레임 id 로 읽히고, 증상은
   * 「뱃지가 안 보인다」다 — 실제 서버에서 라우트 선언 순서가 같은 함정이라 목에서도
   * 같은 순서를 지킨다.
   *
   * **저장소의 지금 상태에서 센다.** 얼려 두면 승인해도 대기 뱃지가 그대로이고,
   * 화면은 「눌렀는데 아무 일도 안 일어난다」를 정상으로 배운다.
   */
  http.get(mockPaths.sellerClaimSummary, () =>
    answering(() =>
      HttpResponse.json(
        defineFixture(sellerClaimSummaryResponseSchema, {
          summary: sellerClaimSummaryOf(sellerClaimSnapshot()),
        }),
      ),
    ),
  ),

  /** `GET /seller-claims` — 한 페이지, 걸러서, **대기 먼저**. */
  http.get(mockPaths.sellerClaims, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = sellerClaimListQueryParamsSchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      )
      const limit = query.limit ?? SELLER_CLAIM_LIST_DEFAULT_LIMIT
      const cursor = cursorOf(query.cursor)
      const matches = sortSellerClaims(sellerClaimSnapshot())
        .filter((item) => query.stage === undefined || item.stage === query.stage)
        .filter((item) => query.type === undefined || item.type === query.type)
        .filter((item) => query.status === undefined || query.status.includes(item.status))
        // 커서는 **자리**다. 「마지막으로 본 행」을 찾지 않으므로, 그 행의 상태가
        // 그 사이에 바뀌어도 재개 지점이 함께 움직이지 않는다.
        .filter((item) => cursor === null || isAfter(item, cursor))
      const page = matches.slice(0, limit)
      const last = page.at(-1)

      return HttpResponse.json(
        defineFixture(sellerClaimListResponseSchema, {
          claims: [...page],
          nextCursor:
            matches.length > limit && last !== undefined
              ? encodeCursor({ stageRank: sellerClaimStageRank(last.stage), id: last.id })
              : null,
        }),
      )
    }),
  ),

  /**
   * `POST /claims/:id/transitions` — 승인과 거절.
   *
   * **멱등이다.** 이미 목표 상태면 아무 일도 하지 않고 `changed: false` 로 성공한다 —
   * 재시도한 화면에 오류를 보이는 것은, 그 사람이 원한 결과가 이미 이뤄져 있는데
   * 실패했다고 말하는 것이다.
   */
  http.post(mockPaths.claimTransitions, ({ params, request }) =>
    answering(async () => {
      const body = await readBody(request, claimTransitionRequestSchema)
      const row = rowOf(String(params.id))

      refusingOnce()

      if (row.claim.status === body.to) {
        return HttpResponse.json(
          defineFixture(claimTransitionResponseSchema, { claim: row.claim, changed: false }),
        )
      }

      assertStep(row, body.to)

      // **거절인데 사유가 없다.** 화면이 먼저 막는 것은 친절이고, 거절되는 것이
      // 규칙이다 — 화면만 막으면 API 를 직접 부르는 길이 남는다.
      if (sellerClaimNeedsReason(body.to) && !hasText(body.reason)) {
        throw new MockApiError(400, '거절 사유를 입력해 주세요.', {
          code: 'CLAIM_REASON_REQUIRED',
          field: 'reason',
        })
      }

      moveTo(row, body.to, body.reason ?? null)

      return HttpResponse.json(
        defineFixture(claimTransitionResponseSchema, { claim: row.claim, changed: true }),
      )
    }),
  ),

  /**
   * `POST /returns/:claimId/pickup` — 수거를 시작한다.
   *
   * **발급과 전이가 함께 일어난다.** 갈라 두면 「회수 중이라고 말해 놓고 어디로
   * 보내야 하는지 답하지 못하는」 구간이 생기고, 그 구간을 재현하는 대역으로 검사한
   * 화면은 운송장이 없는 화면을 정상으로 배운다.
   */
  http.post(mockPaths.returnPickup, ({ params }) =>
    answering(() => {
      const row = rowOf(String(params.claimId))
      const detail = returnOf(row)

      refusingOnce()
      assertStep(row, 'PICKING_UP')

      row.returnDetail = {
        ...detail,
        shipments: [...detail.shipments, sellerReturnShipmentOf(seedOf(row), 'PICKUP')],
      }
      moveTo(row, 'PICKING_UP', null)

      return returnAnswer(row)
    }),
  ),

  /**
   * `POST /returns/:claimId/inspection` — 입고 검수.
   *
   * **합격 여부가 다음 상태를 가른다.** 요청이 상태를 직접 고르게 두면 검수가
   * 「반품완료로 옮겨 줘」가 되고, 그때 검수 결과와 전이가 서로 다른 사실을 말할 수
   * 있다.
   *
   * 불합격은 **반송**이다. 물건은 판매자에게 있고 그것은 구매자의 것이므로, 결과를
   * 적는 것과 같은 걸음에서 반대 방향 운송장이 난다.
   */
  http.post(mockPaths.returnInspection, ({ params, request }) =>
    answering(async () => {
      const body = await readBody(request, inspectReturnRequestSchema)
      const row = rowOf(String(params.claimId))
      const detail = returnOf(row)
      const to: ClaimStatus = body.passed ? 'RETURN_COMPLETED' : 'RETURN_REJECTED'

      refusingOnce()
      assertStep(row, to)

      // **검수 불합격도 거절이다** (TASK-0070 5장). 붙는 자리가 `reason` 이 아니라
      // `note` 인 것은 이 요청에 `reason` 이라는 칸이 없기 때문이다 — 그 이름으로
      // 답하면 화면은 오류를 어느 입력에도 놓지 못한다.
      if (sellerClaimNeedsReason(to) && !hasText(body.note)) {
        throw new MockApiError(400, '불합격 사유를 입력해 주세요.', {
          code: 'CLAIM_REASON_REQUIRED',
          field: 'note',
        })
      }

      const note = body.note ?? null

      row.returnDetail = {
        ...detail,
        shipments: body.passed
          ? detail.shipments
          : [...detail.shipments, sellerReturnShipmentOf(seedOf(row), 'SEND_BACK')],
        inspection: { passed: body.passed, note, inspectedAt: MOCK_SELLER_CLAIM_NOW },
      }
      // 검수 결과와 전이 사유가 **한 사실**이다. 불합격의 근거를 부속에만 적으면
      // 이력에는 사유 없는 거절이 남는다.
      moveTo(row, to, note)

      return returnAnswer(row)
    }),
  ),

  /** `GET /seller-claims/:id` — 항목 · 사진 · 환불 예정액 · 기한 · 버튼이 한 응답. */
  http.get(mockPaths.sellerClaim, ({ params }) =>
    answering(() => detailAnswer(rowOf(String(params.id)))),
  ),
]

/** 이 줄이 나온 씨앗. 운송장 번호가 줄마다 달라야 하므로 자리를 되찾는다. */
function seedOf(row: MockSellerClaimRow) {
  const seed = mockSellerClaimSeeds.find((candidate) => candidate.id === row.claim.id)

  if (seed === undefined) throw new MockApiError(404, '클레임을 찾을 수 없어요.')

  return seed
}
