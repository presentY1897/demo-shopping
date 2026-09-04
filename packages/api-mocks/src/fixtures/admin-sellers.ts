import type { Seller, SellerStatus } from '@shopping/shared'
import { sellerResponseSchema, sellerReviewListResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * The review queue, as `GET /api/v1/admin/sellers` answers it (TASK-0108).
 *
 * **A hundred applications, because that is the number TASK-0110 F3 asks about.**
 * The question a review queue has to survive is "does paging forward and back
 * repeat or drop a row", and a five row fixture cannot be asked it: the default
 * page is twenty, so anything smaller has exactly one page and the cursor is
 * never exercised at all.
 *
 * **The four statuses are laid out newest-first on purpose.** Ids are UUIDv7 and
 * the queue is `ORDER BY id DESC`, so the highest ids are the newest
 * applications — and those are the ones still waiting. Forty `PENDING` at the
 * top is what a real queue looks like, and it also gives the status filter two
 * full pages to page through rather than one.
 *
 * | 위치 (n) | 상태 | 건수 |
 * | --- | --- | --- |
 * | 61–100 | `PENDING` | 40 |
 * | 31–60 | `ACTIVE` | 30 |
 * | 16–30 | `REJECTED` | 15 |
 * | 1–15 | `SUSPENDED` | 15 |
 *
 * Brand names are invented (CLAUDE.md 6장 — 실제 상표를 쓰지 않는다) and are
 * built from two syllable lists so that a hundred of them are distinct without
 * anybody typing a hundred of them, which is also how `Seller_brandName_key`
 * would see them.
 */

/** Ids share a UUIDv7 prefix, so sorting them as text is sorting them by age. */
const SELLER_ID_PREFIX = '019596e0-0001-7000-8000-00000000'
const OWNER_ID_PREFIX = '019596e0-0002-7000-8000-00000000'

/** 2026-08-01T00:00:00.000Z. Fixed, so a fixture parsed at load never ages. */
const FIRST_APPLIED_AT = Date.UTC(2026, 7, 1)

const HOUR_MS = 3_600_000

const QUEUE_SIZE = 100

const HEAD = ['루미', '아틀', '노브', '세이', '카뮈', '오르', '베르', '리안', '모브', '유안']

const TAIL = ['에르', '리에', '스톤', '가든', '로브', '메종', '필드', '아뜰', '노트', '워크']

/** What each position in the queue is. Newest first, so the top is still waiting. */
function statusAt(n: number): SellerStatus {
  if (n > 60) return 'PENDING'
  if (n > 30) return 'ACTIVE'
  if (n > 15) return 'REJECTED'
  return 'SUSPENDED'
}

/**
 * Why a store is where it is, or `null` when nothing was said.
 *
 * `PENDING` never carries one — nobody has decided yet — and an approval clears
 * whatever was there, which is what `SellerService.transition` does with
 * `statusReason: input.reason ?? null`. So a reason on an `ACTIVE` row would be
 * a state the API cannot produce.
 */
function reasonAt(n: number, status: SellerStatus): string | null {
  if (status === 'REJECTED') {
    return n % 2 === 0
      ? '사업자 정보와 브랜드명이 일치하지 않습니다. 확인 후 다시 신청해 주세요.'
      : '스토어 소개에 연락처가 그대로 노출되어 있습니다. 지운 뒤 다시 신청해 주세요.'
  }
  if (status === 'SUSPENDED') return '배송 지연 신고가 반복되어 정지했습니다.'

  return null
}

function sellerAt(n: number): Seller {
  const status = statusAt(n)
  const serial = String(n).padStart(4, '0')
  const createdAt = new Date(FIRST_APPLIED_AT + n * HOUR_MS).toISOString()

  return {
    id: `${SELLER_ID_PREFIX}${serial}`,
    userId: `${OWNER_ID_PREFIX}${serial}`,
    brandName: `${HEAD[n % HEAD.length] ?? ''}${TAIL[(n * 3) % TAIL.length] ?? ''} ${serial}`,
    slug: `store-${serial}`,
    // Every third application skips the introduction and every fourth the logo:
    // both columns are nullable and a screen that never met a `null` would be
    // one nobody checked against the contract.
    introduction:
      n % 3 === 0 ? null : `${serial} 번째 스토어입니다. 데일리 웨어를 직접 만들어 팝니다.`,
    logoUrl: n % 4 === 0 ? null : `https://cdn.test.invalid/sellers/${serial}/logo.png`,
    status,
    statusReason: reasonAt(n, status),
    /**
     * When the status last moved.
     *
     * `null` on exactly one row (n = 100, the newest application). The column is
     * nullable because a row written by a seed rather than by the API carries no
     * decision, and a queue that sorted or formatted that column would otherwise
     * only ever be tested against a value.
     */
    statusChangedAt: n === QUEUE_SIZE ? null : createdAt,
    // A decided store has been written at least once, so its lock has moved.
    version: status === 'PENDING' ? 0 : 1,
    createdAt,
  }
}

const QUEUE: readonly Seller[] = Array.from({ length: QUEUE_SIZE }, (_unused, index) =>
  sellerAt(QUEUE_SIZE - index),
)

/**
 * The whole queue in one page, newest first.
 *
 * A legal response as well as a seed: `limit` may be 100
 * (`SELLER_REVIEW_LIST_MAX_LIMIT`), and at that size there is no next page — so
 * `nextCursor` is `null` and this is exactly what
 * `GET /api/v1/admin/sellers?limit=100` answers.
 */
export const adminSellerQueue = defineFixture(sellerReviewListResponseSchema, {
  sellers: [...QUEUE],
  nextCursor: null,
})

/** Nothing has been applied for yet. The empty state (U1) has to come from somewhere. */
export const adminSellerQueueEmpty = defineFixture(sellerReviewListResponseSchema, {
  sellers: [],
  nextCursor: null,
})

/**
 * One application awaiting review, as `GET /api/v1/admin/sellers/:id` answers it.
 *
 * The newest row, which is also the one whose `statusChangedAt` is `null` — the
 * detail screen has to render "아직 없음" for it rather than an empty cell.
 */
export const adminSellerPending = defineFixture(sellerResponseSchema, {
  seller: QUEUE[0] ?? sellerAt(QUEUE_SIZE),
})
