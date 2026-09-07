/**
 * 신청서의 순수 판단, 남김없이 (TASK-0066 — Q5 순수 로직, 분기 100%).
 *
 * 두 모듈이다. **보낼 수 있는가**(`claim-draft.ts`)와 **왜 안 되는지를 무엇으로
 * 말하는가**(`claim-refusal.ts`). 둘 다 화면을 그리지 않고도 잴 수 있고, 그래서
 * 화면 검사가 「눌렀더니 문장이 나왔다」만 확인하면 되는 이유가 여기 있다.
 *
 * 뒤엣것이 조용히 틀린다. 코드 하나를 빠뜨리면 그 거절은 **서버의 문장**으로
 * 흘러나가고 — 「지금 상태에서는 신청할 수 없어요」 — 화면은 여전히 무언가를
 * 보여 주므로 아무도 신고하지 않는다.
 */

import type { ApiFailure, ClaimableItem, ReturnReason } from '@shopping/shared'
import {
  claimRefusals,
  CLAIM_REASON_MAX_LENGTH,
  RETURN_PHOTO_MAX_COUNT,
  UPLOAD_MAX_BYTES,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { ClaimDraft } from '@/lib/claims/claim-draft'
import {
  claimDraftIssues,
  claimLinesOf,
  quantityChoices,
  withItem,
  withQuantity,
} from '@/lib/claims/claim-draft'
import { refusalOfFailure, refusalSentence } from '@/lib/claims/claim-refusal'
import { returnPhotosRequired } from '@/lib/claims/return-photos'
import { checkPhotoUpload } from '@/lib/uploads/photo-uploads'
import { messagesFor } from '@/messages'

const sentences = messagesFor().mypage.claim.refusals

/** 잔여만 다른 항목 하나. 나머지 필드는 이 파일의 판단에 쓰이지 않는다. */
function item(orderItemId: string, remaining: number): ClaimableItem {
  return {
    orderItemId,
    variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000001',
    snapshot: {
      productId: '019596d0-1f1c-7c2e-9a0e-5d0000000001',
      productName: '울 롱코트',
      optionLabel: '블랙 / M',
      sku: 'LUMICOAT-1',
      thumbnailUrl: null,
      brandName: '루미에르',
    },
    quantity: remaining,
    claimedQuantity: 0,
    remainingQuantity: remaining,
  }
}

function httpFailure(code: string, details: readonly unknown[] = []): ApiFailure {
  return { kind: 'http', status: 409, code, message: '서버의 문장', details, requestId: null }
}

/** 취소 신청서 하나. 반품 칸이 없는 것이 취소의 정의다. */
function draft(overrides: Partial<ClaimDraft> = {}): ClaimDraft {
  return { selection: { a: 1 }, reason: '색이 달라요', returns: null, ...overrides }
}

/** 반품 신청서 하나. 사유와, 지금까지 붙은 사진. */
function returnDraft(
  returnReason: ReturnReason,
  photoKeys: readonly string[] = [],
  uploading = false,
): ClaimDraft {
  return draft({ returns: { returnReason, photoKeys, uploading } })
}

describe('1. 보낼 수 있는가', () => {
  it('needs an item and a reason', () => {
    expect(claimDraftIssues(draft({ selection: {}, reason: '' }))).toEqual([
      'no_items',
      'reason_required',
    ])
  })

  /**
   * **둘 다 돌려준다.** 하나만 말하면 사람은 항목을 고르고 나서야 사유가 필요하다는
   * 것을 알게 되고, 그것은 같은 화면을 두 번 읽게 만드는 일이다.
   */
  it('is happy once both are there', () => {
    expect(claimDraftIssues(draft({ reason: ' 색이 달라요 ' }))).toEqual([])
  })

  it('does not accept whitespace as a reason', () => {
    expect(claimDraftIssues(draft({ reason: '   ' }))).toEqual(['reason_required'])
  })

  it('refuses a reason past the contract limit, and accepts one exactly at it', () => {
    const at = 'ㄱ'.repeat(CLAIM_REASON_MAX_LENGTH)

    expect(claimDraftIssues(draft({ reason: at }))).toEqual([])
    expect(claimDraftIssues(draft({ reason: `${at}ㄱ` }))).toEqual(['reason_too_long'])
  })
})

/**
 * 반품에만 있는 두 갈래 (TASK-0067 F2).
 *
 * 서버도 같은 것을 거절하지만(`RETURN_PHOTO_REQUIRED`), 그 거절은 사진을 다 고르고
 * **보낸 뒤**에 온다. 여기서 잡는 것이 그 왕복 하나이고, 무엇보다 「사진 없이 보낸
 * 하자 반품」이 아예 만들어지지 않는다.
 */
describe('1-1. 반품 신청서', () => {
  it('asks for a photo when the reason blames the seller', () => {
    expect(claimDraftIssues(returnDraft('DEFECTIVE'))).toEqual(['photo_required'])
    expect(claimDraftIssues(returnDraft('WRONG_ITEM'))).toEqual(['photo_required'])
  })

  it('is happy with one photo attached', () => {
    expect(claimDraftIssues(returnDraft('DEFECTIVE', ['returns/u/p.png']))).toEqual([])
  })

  /** 변심에는 칸 자체가 없다. 붙일 수 없으니 없다고 나무랄 일도 없다. */
  it('asks for nothing when the buyer simply changed their mind', () => {
    expect(claimDraftIssues(returnDraft('CHANGE_OF_MIND'))).toEqual([])
    expect(returnPhotosRequired('CHANGE_OF_MIND')).toBe(false)
  })

  /**
   * **올라가는 중이면 아직이다.** 지금 보내면 그 장의 열쇠가 빠진 신청서가 나가고,
   * 사람은 자기가 붙인 사진 하나가 사라진 것을 신청 뒤에야 알게 된다.
   */
  it('waits for a photo still on its way, even when one is already attached', () => {
    expect(claimDraftIssues(returnDraft('DEFECTIVE', ['returns/u/p.png'], true))).toEqual([
      'photo_uploading',
    ])
  })

  it('reports both when nothing has landed yet and one is still going', () => {
    expect(claimDraftIssues(returnDraft('DEFECTIVE', [], true))).toEqual([
      'photo_required',
      'photo_uploading',
    ])
  })
})

/**
 * 고른 파일 하나가 올라갈 수 있는가.
 *
 * 셋을 나누는 기준은 **사람이 할 일이 다른가**다 — 형식은 다른 파일을 고르는
 * 일이고, 크기는 줄이는 일이며, 장수는 하나를 빼는 일이다. 하나로 묶으면
 * 「첨부할 수 없습니다」 말고 할 말이 없어진다.
 */
describe('1-2. 고른 파일', () => {
  it('takes a jpeg under the cap', () => {
    expect(checkPhotoUpload({ type: 'image/jpeg', size: 1024 }, 0, RETURN_PHOTO_MAX_COUNT)).toEqual(
      {
        ok: true,
        contentType: 'image/jpeg',
      },
    )
  })

  it('refuses a format the bucket does not accept', () => {
    // SVG 는 브라우저에서 실행되는 문서라 계약이 아예 받지 않는다.
    expect(
      checkPhotoUpload({ type: 'image/svg+xml', size: 1024 }, 0, RETURN_PHOTO_MAX_COUNT),
    ).toEqual({
      ok: false,
      reason: 'unsupported_type',
    })
  })

  it('accepts a file exactly at the cap and refuses the next byte', () => {
    expect(
      checkPhotoUpload({ type: 'image/png', size: UPLOAD_MAX_BYTES }, 0, RETURN_PHOTO_MAX_COUNT).ok,
    ).toBe(true)
    expect(
      checkPhotoUpload(
        { type: 'image/png', size: UPLOAD_MAX_BYTES + 1 },
        0,
        RETURN_PHOTO_MAX_COUNT,
      ),
    ).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })

  /** 장수를 먼저 보는 이유는 그 답이 파일과 무관하기 때문이다 — 여섯째는 무엇이든 안 된다. */
  it('refuses anything once the contract limit is already attached', () => {
    expect(
      checkPhotoUpload(
        { type: 'image/png', size: 1 },
        RETURN_PHOTO_MAX_COUNT,
        RETURN_PHOTO_MAX_COUNT,
      ),
    ).toEqual({
      ok: false,
      reason: 'too_many',
    })
  })
})

describe('2. 고른 것', () => {
  it('starts an item at one — the partial claim is the normal one', () => {
    expect(withItem({}, 'a', true)).toEqual({ a: 1 })
  })

  it('keeps a quantity already chosen when the box is toggled back on', () => {
    expect(withItem(withItem({ a: 3 }, 'a', false), 'a', true)).toEqual({ a: 1 })
  })

  it('drops the item entirely when unchecked', () => {
    expect(withItem({ a: 2, b: 1 }, 'a', false)).toEqual({ b: 1 })
  })

  /**
   * 고르지 않은 항목의 수량은 바뀌지 않는다.
   *
   * 바뀌면 「고르지 않았는데 수량이 2인」 상태가 생기고, 그 상태에서 요청에 무엇이
   * 실릴지는 두 값을 읽는 순서가 정한다.
   */
  it('never gives a quantity to an item nobody chose', () => {
    expect(withQuantity({ a: 1 }, 'b', 3)).toEqual({ a: 1 })
  })

  it('changes the quantity of a chosen one', () => {
    expect(withQuantity({ a: 1 }, 'a', 3)).toEqual({ a: 3 })
  })

  it('sends the chosen lines in the order the list shows them', () => {
    const items = [item('a', 1), item('b', 2), item('c', 3)]

    expect(claimLinesOf({ c: 2, a: 1 }, items)).toEqual([
      { orderItemId: 'a', quantity: 1 },
      { orderItemId: 'c', quantity: 2 },
    ])
  })

  it('offers exactly the quantities the server says are left', () => {
    expect(quantityChoices(item('a', 3))).toEqual([1, 2, 3])
    expect(quantityChoices(item('a', 0))).toEqual([])
  })
})

describe('3. 거절을 문장으로', () => {
  /**
   * **여섯 전부에 코드가 있다.** 하나라도 빠지면 그 거절은 서버 문장으로 흘러나가고,
   * 화면은 여전히 무언가를 보여 주므로 아무도 신고하지 않는다.
   */
  it('reads every refusal the contract knows about', () => {
    const codes = {
      in_transit: 'CLAIM_IN_TRANSIT',
      confirmed: 'CLAIM_ORDER_CONFIRMED',
      window_closed: 'CLAIM_WINDOW_CLOSED',
      not_claimable: 'CLAIM_NOT_CLAIMABLE',
      exceeds_remaining: 'CLAIM_EXCEEDS_REMAINING',
      invalid_quantity: 'CLAIM_INVALID_QUANTITY',
    } as const

    expect(
      claimRefusals.map((reason) => refusalOfFailure(httpFailure(codes[reason]))?.reason),
    ).toEqual([...claimRefusals])
  })

  it('is not a claim refusal when the code belongs to something else', () => {
    expect(refusalOfFailure(httpFailure('ORDER_TRANSITION_UNDEFINED'))).toBeNull()
  })

  /** 답이 없는 실패는 코드가 없다. 여섯 중 무엇도 아니다. */
  it('is not a claim refusal when nothing answered', () => {
    expect(refusalOfFailure({ kind: 'transport', reason: 'network' })).toBeNull()
  })

  it('carries the number only the quantity refusal has', () => {
    const detail = refusalOfFailure(
      httpFailure('CLAIM_EXCEEDS_REMAINING', [
        {
          field: 'items',
          message: '넘었어요',
          code: 'CLAIM_EXCEEDS_REMAINING',
          params: { remaining: 2 },
        },
      ]),
    )

    expect(detail).toEqual({ reason: 'exceeds_remaining', remaining: 2 })
  })

  /**
   * 없으면 `null` 이지 0 이 아니다. 0 은 「하나도 못 신청한다」는 사실이고, 모르는
   * 것과 다르다.
   */
  it.each([
    ['no details at all', []],
    ['a plain sentence', ['수량을 확인해 주세요']],
    ['an entry without params', [{ field: 'items', message: '넘었어요' }]],
    ['params without the number', [{ field: 'items', message: '넘었어요', params: {} }]],
    [
      'a number that is not one',
      [{ field: 'items', message: '넘었어요', params: { remaining: '2' } }],
    ],
  ])('does not invent a number from %s', (_name, details) => {
    expect(refusalOfFailure(httpFailure('CLAIM_EXCEEDS_REMAINING', details))?.remaining).toBeNull()
  })

  it('fills the number into the one sentence that asks for it', () => {
    expect(refusalSentence({ reason: 'exceeds_remaining', remaining: 2 }, sentences)).toContain('2')
  })

  /** `{remaining}` 이 없는 문장에 값을 넣어도 그대로 돌아온다. */
  it('leaves a sentence without a placeholder alone', () => {
    expect(refusalSentence({ reason: 'in_transit', remaining: 7 }, sentences)).toBe(
      sentences.in_transit,
    )
  })

  /** 여섯이 서로 다른 말을 한다. 같으면 나눈 의미가 없다. */
  it('says something different for each of the six', () => {
    expect(new Set(claimRefusals.map((reason) => sentences[reason])).size).toBe(
      claimRefusals.length,
    )
  })

  /** 어느 문장에도 자리표시자가 남지 않는다. `{remaining}` 이 화면에 뜨면 안 된다. */
  it('never leaves a placeholder on screen', () => {
    const rendered = claimRefusals.map((reason) =>
      refusalSentence({ reason, remaining: 1 }, sentences),
    )

    expect(rendered.filter((sentence) => sentence.includes('{'))).toEqual([])
  })
})
