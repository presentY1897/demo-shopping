'use client'

import type { ApiFailure, Coupon, CouponDiscountType, CreateCouponRequest } from '@shopping/shared'
import { apiFailure, couponDiscountTypes, errorMessage, failureMessage } from '@shopping/shared'
import { Button, Checkbox, Input, Select, Skeleton } from '@shopping/ui/components'
import { Form, FormError, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import type { ValidationErrors } from '@shopping/ui/form'
import { useCallback, useMemo } from 'react'

import type { SellerCouponScopeType } from '@/lib/coupons/coupon-console'
import { estimateCouponLiability, SELLER_COUPON_SCOPE_TYPES } from '@/lib/coupons/coupon-console'
import {
  EMPTY_COUPON_FORM,
  SELLER_COUPON_FORM_FIELDS,
  sellerCouponFormSchema,
} from '@/lib/coupons/coupon-form'
import { useOwnProductOptions } from '@/lib/coupons/use-own-product-options'
import type { SellerCouponWrite } from '@/lib/coupons/use-seller-coupons'
import type { Messages } from '@/messages'
import { messagesFor } from '@/messages'

import { CouponLiabilityNotice } from './coupon-liability-notice'

/**
 * 쿠폰 하나를 발행하는 폼 (TASK-0074 5장 2·3항).
 *
 * **경고가 첫 번째 자식이다.** 순서가 설계다 — TASK-0074 4장이 요구하는 것은 「어딘가에
 * 안내가 있다」가 아니라 **발행하기 전에 숫자를 본다**이고, 그것은 위치로만 지켜진다.
 *
 * **범위 셀렉트에 전체와 카테고리가 없다** (F1). 서버가 그 둘을 거절하지만
 * (`COUPON_SCOPE_FORBIDDEN`), 고르게 해 놓고 거절하는 화면은 무엇을 잘못했는지 알려
 * 주지 않는다. 그렇다고 화면만 막는 것도 아니다: 403 이 오면 `mapError` 가 그것을
 * `scopeType` · `scopeIds` 칸에 그대로 붙인다 — 서버가 `details` 로 어느 칸인지
 * 말해 주므로 (계약이 그 이유를 적어 두었다).
 *
 * **상품 목록은 폼이 열릴 때 함께 읽는다.** 범위를 「지정한 상품」으로 바꾼 뒤에
 * 읽기 시작하면, 고르려는 바로 그 순간에 빈 목록과 스켈레톤을 보게 된다. 실패해도
 * 폼을 막지 않는다 — 스토어 전체 쿠폰은 그 목록 없이도 발행할 수 있다.
 */

/** 거절된 쓰기를 `mapError` 가 읽을 수 있는 값으로 나른다. */
class CouponWriteRejection extends Error {
  override readonly name = 'CouponWriteRejection'

  constructor(readonly failure: ApiFailure) {
    super('the coupon write was refused')
  }
}

export interface CouponIssueFormProps {
  /**
   * 이 계정이 소유한 스토어.
   *
   * 요청의 `sellerId` 이자 **부담 주체 그 자체**다 — 계약에 `issuerType` 을 고르는
   * 칸이 없는 것이 그 뜻이고, 그래서 이 폼에도 발행자를 고르는 컨트롤이 없다.
   */
  readonly sellerId: string
  /** 훅이 주는 쓰기. 던지지 않고 결과를 돌려주므로 폼이 계속 그려질 수 있다. */
  readonly issue: (request: CreateCouponRequest) => Promise<SellerCouponWrite>
  /** 발행이 끝났다. 폼을 닫고 결과를 알리는 것은 부르는 쪽의 일이다. */
  readonly onIssued: (coupon: Coupon) => void
  readonly messages?: Messages
}

export function CouponIssueForm({
  sellerId,
  issue,
  onIssued,
  messages = messagesFor(),
}: CouponIssueFormProps) {
  const copy = messages.couponForm
  const vocabulary = messages.coupons
  const products = useOwnProductOptions()

  const schema = useMemo(
    () => sellerCouponFormSchema(sellerId, { messages: copy.errors }),
    [sellerId, copy.errors],
  )

  /**
   * 거절을 칸으로.
   *
   * `COUPON_SCOPE_FORBIDDEN` 이 `scopeType` 또는 `scopeIds` 를 가리키므로 (F1),
   * 그 코드에 대한 `codeFields` 를 따로 둘 필요가 없다 — 서버가 이미 칸을 말했고,
   * `serverFieldErrors` 는 그것을 카탈로그의 문장으로 바꿔 그 칸에 놓는다.
   */
  const mapError = useCallback(
    (error: unknown): ValidationErrors | undefined => {
      const failure = error instanceof CouponWriteRejection ? error.failure : apiFailure(error)
      const fallback = failureMessage(failure, {
        errors: messages.errors,
        failures: messages.apiFailures,
      })

      if (failure.kind !== 'http') return { fieldErrors: {}, formErrors: [fallback] }

      return serverFieldErrors(failure.details, {
        code: failure.code,
        fallbackMessage: fallback,
        fields: [...SELLER_COUPON_FORM_FIELDS],
        // `INVALID` 는 상태가 이미 말하는 것 말고는 아무것도 말하지 않고, 그 옆의
        // 문장이 어느 값이 문제인지 말한다. 카탈로그로 답하면 정보가 줄어든다.
        messageForCode: (code) =>
          code === 'INVALID' ? undefined : errorMessage(messages.errors, code),
      })
    },
    [messages.apiFailures, messages.errors],
  )

  const form = useForm({
    schema,
    initialValues: EMPTY_COUPON_FORM,
    mapError,
    submitErrorMessage: copy.submitFailed,
    onSubmit: async (request) => {
      const result = await issue(request)

      if (result.ok) {
        onIssued(result.coupon)
        return
      }

      throw new CouponWriteRejection(result.failure)
    },
  })

  const discountType = discountTypeOf(form.values.discountType)
  const scopeType = scopeTypeOf(form.values.scopeType)

  /**
   * 예상 최대 부담 — **매 렌더마다 다시 센다** (F3).
   *
   * 이벤트에 매달아 두면 어느 입력에 매달지를 고르게 되고, 고르지 않은 칸이 바뀔 때
   * 숫자가 낡는다. 곱셈 하나이므로 값이 비싸지 않다.
   */
  const liability = estimateCouponLiability({
    discountType,
    discountValue: numberOf(form.values.discountValue),
    maxDiscountAmount: numberOf(form.values.maxDiscountAmount),
    issueLimit: numberOf(form.values.issueLimit),
  })

  const selected = form.multi('scopeIds')

  return (
    <Form aria-label={copy.legend} className="max-w-2xl" form={form}>
      {/* 첫 번째 자식이다. 아래로 내리면 스크롤 밖으로 나가고, 그러면 읽히지 않는다. */}
      <CouponLiabilityNotice liability={liability} messages={copy.warning} />

      <FormError errors={form.formErrors} title={copy.errorTitle} />

      <FormField
        form={form}
        hint={copy.fields.nameHint}
        label={copy.fields.nameLabel}
        name="name"
        required
      >
        <Input {...form.text('name')} autoComplete="off" />
      </FormField>

      <FormField form={form} label={copy.fields.discountTypeLabel} name="discountType" required>
        <Select
          {...form.choice('discountType')}
          options={couponDiscountTypes.map((type) => ({
            value: type,
            label: vocabulary.discountTypeLabels[type],
          }))}
        />
      </FormField>

      <FormField
        form={form}
        hint={copy.fields.discountValueHint[discountType]}
        label={copy.fields.discountValueLabel[discountType]}
        name="discountValue"
        required
      >
        <Input {...form.text('discountValue')} inputMode="numeric" min={1} type="number" />
      </FormField>

      {/*
        정률에만 있는 칸이다. 정액에 상한을 물으면 「5,000원 쿠폰의 최대 할인액」이라는
        뜻 없는 질문이 되고, 계약도 정액의 이 값을 언제나 `null` 로 못박고 있다.
      */}
      {discountType === 'PERCENT' ? (
        <FormField
          form={form}
          hint={copy.fields.maxDiscountAmountHint}
          label={copy.fields.maxDiscountAmountLabel}
          name="maxDiscountAmount"
        >
          <Input {...form.text('maxDiscountAmount')} inputMode="numeric" min={1} type="number" />
        </FormField>
      ) : null}

      <FormField
        form={form}
        hint={copy.fields.minOrderAmountHint}
        label={copy.fields.minOrderAmountLabel}
        name="minOrderAmount"
      >
        <Input {...form.text('minOrderAmount')} inputMode="numeric" min={0} type="number" />
      </FormField>

      <FormField
        form={form}
        hint={copy.fields.scopeTypeHint}
        label={copy.fields.scopeTypeLabel}
        name="scopeType"
        required
      >
        <Select
          {...form.choice('scopeType')}
          options={SELLER_COUPON_SCOPE_TYPES.map((scope) => ({
            value: scope,
            label: vocabulary.scopeTypeLabels[scope],
          }))}
        />
      </FormField>

      {scopeType === 'PRODUCT' ? (
        <FormField
          form={form}
          hint={
            <>
              {copy.fields.scopeIdsHint}
              <span className="block">
                {copy.fields.scopeIdsSelected.replace('{count}', String(selected.values.length))}
              </span>
            </>
          }
          label={copy.fields.scopeIdsLabel}
          name="scopeIds"
          required
          variant="group"
        >
          {products.status === 'loading' ? (
            <div aria-busy="true" aria-label={copy.fields.scopeIdsLoading} role="status">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}

          {/*
            목록을 못 읽어도 폼을 막지 않는다. 스토어 전체 쿠폰은 이것 없이 발행할 수
            있고, 할 수 있는 일까지 뺏는 것이 더 나쁜 결말이다.
          */}
          {products.status === 'error' ? (
            <p className="text-danger text-sm">{copy.fields.scopeIdsFailed}</p>
          ) : null}

          {products.status === 'ready' && products.items.length === 0 ? (
            <p className="text-fg-muted text-sm">{copy.fields.scopeIdsEmpty}</p>
          ) : null}

          {products.status === 'ready' && products.items.length > 0 ? (
            <div className="border-border max-h-64 overflow-y-auto rounded-md border p-2">
              <ul className="flex flex-col gap-2" role="list">
                {products.items.map((product) => (
                  <li key={product.id}>
                    <Checkbox
                      checked={selected.isSelected(product.id)}
                      label={product.name}
                      onCheckedChange={(checked) => {
                        selected.setSelected(product.id, checked === true)
                      }}
                      value={product.id}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {products.status === 'ready' && products.truncated ? (
            <p className="text-fg-subtle text-xs">
              {copy.fields.scopeIdsTruncated.replace('{count}', String(products.items.length))}
            </p>
          ) : null}
        </FormField>
      ) : null}

      <FormField
        form={form}
        hint={copy.fields.periodHint}
        label={copy.fields.validFromLabel}
        name="validFrom"
        required
      >
        <Input {...form.text('validFrom')} type="datetime-local" />
      </FormField>

      <FormField form={form} label={copy.fields.validUntilLabel} name="validUntil" required>
        <Input {...form.text('validUntil')} type="datetime-local" />
      </FormField>

      <FormField
        form={form}
        hint={copy.fields.issueLimitHint}
        label={copy.fields.issueLimitLabel}
        name="issueLimit"
      >
        <Input {...form.text('issueLimit')} inputMode="numeric" min={1} type="number" />
      </FormField>

      {/*
        여기만 `FormField` 를 쓰지 않는다. 체크박스는 라딕스가 `<button>` 으로 그리고
        자기 라벨을 스스로 들 수 있어서, 바깥에 `<label for>` 를 하나 더 두면 같은
        컨트롤에 이름이 두 벌 생긴다. 서버가 이 칸을 거절할 일도 없다 — 코드를 붙일지
        말지에는 틀릴 값이 없다.
      */}
      <Checkbox
        {...form.toggle('withCode')}
        description={copy.fields.withCodeHint}
        label={copy.fields.withCodeLabel}
      />

      <div className="flex flex-wrap gap-2">
        {/*
          중복 제출은 두 겹으로 막는다 (U3). `loading` 이 버튼을 잠그고, 그 아래에서
          `useForm` 의 ref 가 같은 tick 의 두 번째 이벤트를 막는다 — 텍스트 칸에서
          누른 Enter 는 버튼을 지나지 않으므로 위쪽 한 겹만으로는 새어 나간다.
        */}
        <Button loading={form.submitting} type="submit" variant="primary">
          {copy.submitLabel}
        </Button>
      </div>
    </Form>
  )
}

/** 셀렉트가 돌려준 문자열을 계약의 값으로. 못 읽으면 정액 — 폼의 초기값이다. */
function discountTypeOf(value: unknown): CouponDiscountType {
  return couponDiscountTypes.find((type) => type === value) ?? 'FIXED'
}

function scopeTypeOf(value: unknown): SellerCouponScopeType {
  return SELLER_COUPON_SCOPE_TYPES.find((scope) => scope === value) ?? 'SELLER'
}

/**
 * 숫자 칸 하나를 계산용 값으로.
 *
 * 비어 있는 칸과 읽을 수 없는 칸이 **같은 `null`** 이다. 예상 부담을 낼 때 둘은 같은
 * 뜻이기 때문이다 — 어느 쪽이든 곱할 수가 없다. 무엇이 잘못됐는지는 제출할 때
 * 스키마가 그 칸에 적는다.
 */
function numberOf(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}
