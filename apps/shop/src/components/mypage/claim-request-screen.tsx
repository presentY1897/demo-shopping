'use client'

import type {
  ApiFailure,
  Claim,
  ClaimableItem,
  ClaimableResponse,
  ClaimFault,
  ClaimRefusal,
  ReturnReason,
} from '@shopping/shared'
import { RETURN_PHOTO_MAX_COUNT, returnReasons } from '@shopping/shared'
import {
  Button,
  Checkbox,
  DataList,
  Radio,
  RadioGroup,
  Select,
  Textarea,
} from '@shopping/ui/components'
import { formatDate } from '@shopping/ui/format'
import Link from 'next/link'
import { useId, useState } from 'react'

import type { ClaimSelection, ReturnDraft } from '@/lib/claims/claim-draft'
import {
  claimDraftIssues,
  claimLinesOf,
  quantityChoices,
  withItem,
  withQuantity,
} from '@/lib/claims/claim-draft'
import { refusalOfFailure, refusalSentence } from '@/lib/claims/claim-refusal'
import { returnPhotosRequired } from '@/lib/claims/return-photos'
import { useClaimRequest } from '@/lib/claims/use-claim-request'
import { usePhotoUploads } from '@/lib/uploads/use-photo-uploads'
import type { ClaimRequestMessages, ClaimTypeMessages, MyPageMessages } from '@/messages'

import { PhotoField } from '../uploads/photo-field'

import { AccountLoadFailure, AccountLoading, AccountWriteFailure } from './account-notices'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * `/mypage/orders/[id]/claim` — 취소·반품 신청 (TASK-0066).
 *
 * ## 다이얼로그가 아니라 라우트다
 *
 * `pages.md` 가 이 자리를 라우트로 적어 두었고(`/mypage/orders/[id]/claim`), 그
 * 문서가 기준이다. 그것 말고도 이유가 셋이다.
 *
 * - **폼이 길다.** 항목마다 체크박스와 수량이 있고 사유와 귀책이 뒤따른다. 360px
 *   맥시멀 밀도에서 이만한 폼을 다이얼로그에 넣으면 **스크롤 안의 스크롤**이 되고,
 *   그 안에서 초점 덫이 함께 돈다.
 * - **거절이 읽히는 자리여야 한다.** 「배송이 시작되어 취소할 수 없다」는 사람이
 *   앉아서 읽고 다음 할 일을 정하는 문장이다. 다이얼로그는 그것을 띄웠다 닫는다.
 * - **주소가 남는다.** 신청하다 만 화면을 새로고침해도 같은 자리이고, 문의할 때
 *   보낼 수 있는 주소가 있다.
 *
 * ## 묶음을 질의 문자열로 받는다
 *
 * 신청의 단위는 주문이 아니라 **판매자 몫**이다 (D-023). 라우트가 주문 id 를 갖고
 * 있으므로 어느 몫인지는 `?bundle=` 이 말하고, 그것이 없으면 화면은 「잘못된
 * 접근」이 아니라 **돌아갈 곳**을 준다 — 여기 주소를 손으로 쳐서 오는 사람은 없고,
 * 그래도 온 사람에게 필요한 것은 목록이다.
 *
 * ## 취소와 반품이 한 화면이다
 *
 * 요청의 모양이 같다 — 항목·수량·사유·귀책. 다른 것은 **부르는 이름과 기간**뿐이고,
 * 그마저 서버가 답한다(`claimable.type` · `returnWindowEndsAt`). 화면이 상태로
 * 분기해 「배송완료면 반품」을 적으면 그 판단이 세 앱에 흩어진다. 반품이 승인된
 * 뒤의 회수·검수 화면은 TASK-0067 의 것이고, 여기서 끝나는 것은 **신청**이다.
 */
export function ClaimRequestScreen({
  orderId,
  sellerOrderId,
  messages,
}: {
  readonly orderId: string
  /** 어느 판매자 몫인가. 주소에 없으면 `null` 이다. */
  readonly sellerOrderId: string | null
  readonly messages: MyPageMessages
}) {
  const copy = messages.claim
  const orderHref = `/mypage/orders/${orderId}`

  if (sellerOrderId === null) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink href={orderHref} label={copy.backToOrder} />
        <div className="border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-4">
          <h1 className="text-fg text-xl font-bold">{copy.missingBundleTitle}</h1>
          <p className="text-fg-muted text-sm">{copy.missingBundleBody}</p>
        </div>
      </div>
    )
  }

  return (
    <ClaimForm
      copy={copy}
      messages={messages}
      orderHref={orderHref}
      sellerOrderId={sellerOrderId}
    />
  )
}

function ClaimForm({
  copy,
  messages,
  orderHref,
  sellerOrderId,
}: {
  readonly copy: ClaimRequestMessages
  readonly messages: MyPageMessages
  readonly orderHref: string
  readonly sellerOrderId: string
}) {
  const request = useClaimRequest(sellerOrderId)
  const [selection, setSelection] = useState<ClaimSelection>({})
  const [reason, setReason] = useState('')
  const [fault, setFault] = useState<ClaimFault>('CUSTOMER')
  const [returnReason, setReturnReason] = useState<ReturnReason>('CHANGE_OF_MIND')
  const photos = usePhotoUploads({ purpose: 'return-photo', maxCount: RETURN_PHOTO_MAX_COUNT })
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [submitted, setSubmitted] = useState<Claim | null>(null)
  /**
   * 눌러 보기 전에는 오류를 그리지 않는다.
   *
   * 아무것도 고르지 않은 채 화면에 들어온 사람에게 「상품을 골라주세요」를 먼저
   * 보이면, 그것은 안내가 아니라 **아직 하지 않은 일에 대한 지적**이다.
   */
  const [attempted, setAttempted] = useState(false)

  const reasonId = useId()
  const reasonErrorId = useId()
  const issuesId = useId()

  const claimable = request.state.status === 'ready' ? request.state.claimable : null
  /**
   * 반품 경로에서만 채워지는 칸들.
   *
   * **경로는 서버가 답한다.** 화면이 주문 상태로 다시 판단하면 그 규칙이 세 앱에
   * 흩어지고, 여기서는 그 판단이 곧 「귀책을 묻는가 사유를 묻는가」를 가른다.
   */
  const returns: ReturnDraft | null =
    claimable?.type === 'RETURN'
      ? { returnReason, photoKeys: photos.keys, uploading: photos.uploading }
      : null
  const issues = claimDraftIssues({ selection, reason, returns })
  const shown = attempted ? issues : []
  const refusal = failure === null ? null : refusalOfFailure(failure)

  /**
   * 사유를 바꾸면 붙인 사진을 버린다.
   *
   * 단순 변심으로 옮기면 사진 칸 자체가 사라지는데, 그때 열쇠를 들고 있으면
   * **보이지 않는 사진이 붙은 신청**이 나가고 서버가 `RETURN_PHOTO_NOT_ALLOWED`
   * 로 거절한다 — 사람은 화면에 없는 것 때문에 거절당한다.
   */
  function chooseReturnReason(next: ReturnReason): void {
    setReturnReason(next)
    if (!returnPhotosRequired(next)) photos.clear()
  }

  async function send(): Promise<void> {
    setAttempted(true)

    // 이 렌더의 값으로 판단한다. 사람이 누른 것이 화면에 보이던 그 상태이므로,
    // 상태 갱신을 기다렸다 다시 세는 것은 같은 답을 한 프레임 늦게 얻는 일이다.
    if (issues.length > 0) return

    setFailure(null)

    const outcome = await request.submit({
      items: claimLinesOf(selection, claimable?.items ?? []),
      reason: reason.trim(),
      // 계약이 **둘 중 하나**를 요구한다. 반품의 귀책은 사유에서 파생되므로 화면이
      // 주장할 것이 없다 (`createClaimRequestSchema`).
      fault: returns === null ? fault : null,
      return: returns === null ? null : { returnReason, photoKeys: [...returns.photoKeys] },
    })

    if (!outcome.ok) {
      setFailure(outcome.failure)

      return
    }

    setSubmitted(outcome.claim)
  }

  if (submitted !== null) {
    return <ClaimOutcome claim={submitted} copy={copy} orderHref={orderHref} />
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink href={orderHref} label={copy.backToOrder} />

      <DataList
        empty={null}
        error={
          request.state.status === 'error' ? (
            <AccountLoadFailure
              failure={request.state.failure}
              messages={{ ...messages, loadErrorTitle: copy.loadErrorTitle }}
              onRetry={request.reload}
            />
          ) : null
        }
        loading={<AccountLoading label={copy.loadingLabel} rows={2} />}
        state={request.state.status === 'ready' ? 'ready' : request.state.status}
      >
        {claimable === null ? null : (
          <div className="flex flex-col gap-6">
            <ClaimHeading claimable={claimable} copy={copy} />

            {/*
              **신청할 수 없는 주문에도 항목은 그린다.** 무엇에 대한 이야기인지
              모르는 화면에서 거절만 읽는 것은 사람에게 아무 도움이 되지 않는다.
            */}
            <ItemList
              claimable={claimable.items}
              copy={copy}
              disabled={claimable.type === null}
              onSelect={(orderItemId, chosen) => {
                setSelection((current) => withItem(current, orderItemId, chosen))
              }}
              onQuantity={(orderItemId, quantity) => {
                setSelection((current) => withQuantity(current, orderItemId, quantity))
              }}
              selection={selection}
            />

            {claimable.type === null ? null : (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-fg text-sm font-medium" htmlFor={reasonId}>
                    {copy.reasonLabel}
                  </label>
                  <p className="text-fg-muted text-xs" id={`${reasonId}-hint`}>
                    {copy.reasonHint}
                  </p>
                  <Textarea
                    aria-describedby={
                      shown.includes('reason_required') || shown.includes('reason_too_long')
                        ? `${reasonId}-hint ${reasonErrorId}`
                        : `${reasonId}-hint`
                    }
                    id={reasonId}
                    invalid={shown.includes('reason_required') || shown.includes('reason_too_long')}
                    onChange={(event) => {
                      setReason(event.target.value)
                    }}
                    placeholder={copy.reasonPlaceholder}
                    rows={4}
                    value={reason}
                  />
                  {/*
                    U2 — 오류는 그 칸 **아래**에 붙는다. 폼 맨 위에 모아 두면 어느
                    칸이 문제인지 사람이 다시 찾아야 한다.
                  */}
                  <p className="text-danger text-sm" id={reasonErrorId}>
                    {shown.includes('reason_required')
                      ? copy.issues.reason_required
                      : shown.includes('reason_too_long')
                        ? copy.issues.reason_too_long
                        : ''}
                  </p>
                </div>

                {/*
                  **취소는 귀책을, 반품은 사유를 묻는다.** 한 화면에 둘 다 두면 서로
                  다른 답을 하는 칸이 둘이 되고, 계약이 정확히 하나만 받으므로 그
                  화면은 언제나 하나를 버린다.
                */}
                {returns === null ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-fg text-sm font-medium">{copy.faultLegend}</legend>
                    <RadioGroup
                      onValueChange={(value) => {
                        setFault(value as ClaimFault)
                      }}
                      value={fault}
                    >
                      <Radio
                        description={copy.faults.CUSTOMER.description}
                        label={copy.faults.CUSTOMER.label}
                        value="CUSTOMER"
                      />
                      <Radio
                        description={copy.faults.SELLER.description}
                        label={copy.faults.SELLER.label}
                        value="SELLER"
                      />
                    </RadioGroup>
                  </fieldset>
                ) : (
                  <>
                    <fieldset className="flex flex-col gap-2">
                      <legend className="text-fg text-sm font-medium">
                        {copy.returnReasonLegend}
                      </legend>
                      <RadioGroup
                        onValueChange={(value) => {
                          chooseReturnReason(value as ReturnReason)
                        }}
                        value={returnReason}
                      >
                        {returnReasons.map((value) => (
                          <Radio
                            description={copy.returnReasons[value].description}
                            key={value}
                            label={copy.returnReasons[value].label}
                            value={value}
                          />
                        ))}
                      </RadioGroup>
                    </fieldset>

                    {/*
                      **단순 변심에는 칸이 없다.** 뒤집을 것이 없는 주장에 증거를
                      받을 이유가 없고, 받아 두면 아무도 보지 않는 이미지와 지우지
                      못하는 개인정보만 쌓인다 (`return-rules.ts` 의 `PHOTO_RULE`).
                    */}
                    {returnPhotosRequired(returnReason) ? (
                      <PhotoField
                        copy={copy.photos}
                        invalid={shown.includes('photo_required')}
                        issue={
                          shown.includes('photo_required')
                            ? copy.issues.photo_required
                            : shown.includes('photo_uploading')
                              ? copy.issues.photo_uploading
                              : ''
                        }
                        uploads={photos}
                      />
                    ) : null}
                  </>
                )}

                {/*
                  고른 것이 없다는 것은 어느 칸의 문제도 아니라 **폼 전체**의
                  문제다. 그래서 이 문장만 제출 버튼 옆에 산다.
                */}
                <p className="text-danger text-sm" id={issuesId}>
                  {shown.includes('no_items') ? copy.issues.no_items : ''}
                </p>

                {/*
                  거절 여섯은 **저마다 다른 문장**을 갖는다. 그 밖의 실패 — 네트워크,
                  5xx, 처음 보는 코드 — 는 요청 번호까지 붙는 공용 자리로 간다.
                */}
                {refusal === null ? null : (
                  <p className="border-danger text-fg rounded-md border p-3 text-sm" role="alert">
                    {refusalSentence(refusal, copy.refusals)}
                  </p>
                )}

                {failure === null || refusal !== null ? null : (
                  <AccountWriteFailure
                    failure={failure}
                    messages={messages}
                    title={copy.submitErrorTitle}
                  />
                )}

                <div>
                  <Button
                    aria-describedby={issuesId}
                    loading={request.submitting}
                    onClick={() => {
                      void send()
                    }}
                    type="button"
                    variant="primary"
                  >
                    {request.submitting ? copy.submitting : copy.submit}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DataList>
    </div>
  )
}

/** 제목과, 신청할 수 없으면 그 이유. 둘이 한 자리인 것은 둘 다 「무엇에 대한 화면인가」라서다. */
function ClaimHeading({
  claimable,
  copy,
}: {
  readonly claimable: ClaimableResponse
  readonly copy: ClaimRequestMessages
}) {
  // 신청할 수 없는 주문에는 **유형이 없다.** 「취소 신청」도 「반품 신청」도 거짓이라
  // 중립적인 이름을 쓴다 — 경로는 주문 상태가 정하고, 그 상태가 아무것도 열지
  // 않았다면 이 화면에도 이름 붙일 경로가 없다.
  const typeCopy: ClaimTypeMessages | null =
    claimable.type === null ? null : copy.types[claimable.type]

  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-fg text-xl font-bold">{typeCopy?.title ?? copy.refusedTitle}</h1>

      {typeCopy === null ? (
        <ClaimRefusalNotice copy={copy} refusal={claimable.refusal} />
      ) : (
        <>
          <p className="text-fg-muted text-sm">{typeCopy.description}</p>
          <ClaimWindowNotice
            endsAt={claimable.returnWindowEndsAt}
            template={typeCopy.windowNotice}
          />
        </>
      )}
    </header>
  )
}

/**
 * 왜 신청할 수 없는지.
 *
 * `refusal` 이 `null` 인데 경로도 없는 조합은 계약상 있을 수 없다 — 경로가 없으면
 * 이유가 있다. 그래도 문장을 지어내지 않고 비워 두는 것은, 틀린 이유를 자신 있게
 * 적는 것이 아무 말도 안 하는 것보다 나쁘기 때문이다.
 */
function ClaimRefusalNotice({
  copy,
  refusal,
}: {
  readonly copy: ClaimRequestMessages
  readonly refusal: ClaimRefusal | null
}) {
  if (refusal === null) return null

  return (
    <p
      className="border-border bg-surface-muted text-fg rounded-md border p-3 text-sm"
      role="alert"
    >
      {refusalSentence({ reason: refusal, remaining: null }, copy.refusals)}
    </p>
  )
}

/**
 * 언제까지 신청할 수 있는지 — **반품에만 있다.**
 *
 * 날짜를 화면이 더해 만들지 않는다. 기간의 축은 배포 설정(`FULFILLMENT_PACE`)이
 * 정하고 어떤 응답에도 실리지 않으므로, 시간을 압축한 데모에서 화면이 계산하면
 * 틀린 날짜를 자신 있게 적는다.
 */
function ClaimWindowNotice({
  endsAt,
  template,
}: {
  readonly endsAt: string | null
  readonly template: string | null
}) {
  if (template === null || endsAt === null) return null

  return (
    <p className="text-fg-muted text-sm">
      {template.replace(
        '{date}',
        formatDate(endsAt, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE }),
      )}
    </p>
  )
}

/** 신청할 수 있는 줄들. 잔여가 0인 줄은 **감추지 않고** 왜 못 고르는지 말한다. */
function ItemList({
  claimable,
  copy,
  disabled,
  selection,
  onSelect,
  onQuantity,
}: {
  readonly claimable: readonly ClaimableItem[]
  readonly copy: ClaimRequestMessages
  readonly disabled: boolean
  readonly selection: ClaimSelection
  readonly onSelect: (orderItemId: string, chosen: boolean) => void
  readonly onQuantity: (orderItemId: string, quantity: number) => void
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-fg text-lg font-semibold">{copy.itemsLabel}</h2>

      <ul aria-label={copy.itemsLabel} className="flex flex-col gap-3">
        {claimable.map((item) => (
          <ItemRow
            copy={copy}
            disabled={disabled}
            item={item}
            key={item.orderItemId}
            onQuantity={onQuantity}
            onSelect={onSelect}
            quantity={selection[item.orderItemId] ?? null}
          />
        ))}
      </ul>
    </section>
  )
}

function ItemRow({
  copy,
  disabled,
  item,
  quantity,
  onSelect,
  onQuantity,
}: {
  readonly copy: ClaimRequestMessages
  readonly disabled: boolean
  readonly item: ClaimableItem
  /** 고른 수량. 고르지 않았으면 `null` 이다. */
  readonly quantity: number | null
  readonly onSelect: (orderItemId: string, chosen: boolean) => void
  readonly onQuantity: (orderItemId: string, quantity: number) => void
}) {
  const quantityId = useId()
  const name = `${item.snapshot.productName} ${item.snapshot.optionLabel}`.trim()
  const exhausted = item.remainingQuantity === 0

  return (
    <li className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start gap-3">
        {exhausted || disabled ? (
          <span className="text-fg text-sm font-medium">{name}</span>
        ) : (
          <Checkbox
            checked={quantity !== null}
            label={name}
            onCheckedChange={(checked) => {
              onSelect(item.orderItemId, checked === true)
            }}
          />
        )}
      </div>

      {/*
        **잔여는 서버가 준 값이다.** 화면이 `quantity - claimedQuantity` 로
        계산하면 다른 탭에서 방금 신청한 것이 반영되지 않는다.
      */}
      <p className="text-fg-muted text-xs tabular-nums">
        {exhausted
          ? copy.alreadyClaimed
          : copy.remainingLabel.replace('{count}', String(item.remainingQuantity))}
      </p>

      {quantity === null || exhausted ? null : (
        <div className="flex items-center gap-2">
          <label className="text-fg-muted text-xs" htmlFor={quantityId}>
            {copy.quantityLabel}
          </label>
          {/*
            고를 수 있는 값만 목록에 있으므로 **0개도, 잔여를 넘는 수도 칠 수 없다.**
            그래도 서버의 두 거절(`invalid_quantity` · `exceeds_remaining`)이 문장을
            갖는 이유는, 목록이 만들어진 뒤에 다른 창에서 신청이 하나 들어오면 이
            목록이 낡기 때문이다.
          */}
          <Select
            aria-label={`${name} ${copy.quantityLabel}`}
            id={quantityId}
            onValueChange={(value) => {
              onQuantity(item.orderItemId, Number(value))
            }}
            options={quantityChoices(item).map((count) => ({
              value: String(count),
              label: String(count),
            }))}
            size="sm"
            value={String(quantity)}
          />
        </div>
      )}
    </li>
  )
}

/**
 * 접수된 뒤 (F1 · F4).
 *
 * **자동 승인과 승인 대기를 다르게 말한다.** 둘 다 「접수됐습니다」로 끝내면 자동
 * 승인된 사람은 오지 않을 연락을 기다리고, 승인 대기인 사람은 이미 끝난 줄 안다.
 * 그 갈림은 서버가 답한 `claim.status` 가 정한다 — 화면이 주문 상태로 다시
 * 판단하면 규칙이 두 벌이 된다.
 */
function ClaimOutcome({
  claim,
  copy,
  orderHref,
}: {
  readonly claim: Claim
  readonly copy: ClaimRequestMessages
  readonly orderHref: string
}) {
  const approved = claim.status === 'CANCEL_APPROVED'

  return (
    <div className="flex flex-col gap-4" role="status">
      <h1 className="text-fg text-xl font-bold">{copy.outcome.title}</h1>

      <div className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4">
        <p className="text-fg font-medium">
          {approved ? copy.outcome.approvedTitle : copy.outcome.waitingTitle}
        </p>
        <p className="text-fg-muted text-sm">
          {approved ? copy.outcome.approvedBody : copy.outcome.waitingBody}
        </p>
        {/* 환불은 이 TASK 가 하지 않는다 (TASK-0068). 하지 않은 일을 한 것처럼 말하지 않는다. */}
        <p className="text-fg-muted text-sm">{copy.outcome.refundPending}</p>
      </div>

      <Link className="text-primary self-start text-sm underline" href={orderHref}>
        {copy.outcome.backToOrder}
      </Link>
    </div>
  )
}

function BackLink({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <Link className="text-primary self-start text-sm underline" href={href}>
      {label}
    </Link>
  )
}
