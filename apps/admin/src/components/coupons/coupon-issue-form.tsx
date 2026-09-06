'use client'

import type { ApiFailure, CreateCouponRequest, ErrorMessages } from '@shopping/shared'
import { couponDiscountTypes, errorMessage } from '@shopping/shared'
import { Button, Checkbox, Input, Select } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import {
  ConfirmDialog,
  Form,
  FormError,
  FormField,
  serverFieldErrors,
  useConfirm,
  useForm,
} from '@shopping/ui/form'
import { useMemo } from 'react'

import type { CategoryChoice } from '@/lib/attributes/categories'
import type { OfferedScopeType } from '@/lib/coupons/form-schema'
import {
  COUPON_FORM_FIELDS,
  couponFormSchema,
  EMPTY_COUPON_FORM,
  OFFERED_SCOPE_TYPES,
} from '@/lib/coupons/form-schema'
import { estimateCouponCost, integerFrom } from '@/lib/coupons/platform-coupons'
import type { PlatformCouponMessages } from '@/messages'

import { CouponCostSummary } from './coupon-cost-summary'

/**
 * 쿠폰을 내는 자리 — 유형·값·조건·범위·기간·수량, 그리고 **누가 무는지**.
 *
 * ## 예상 비용이 폼 안에 있는 이유 (F3)
 *
 * 「발급 수량 × 최대 할인액」은 발행 버튼 옆에 있어야 뜻이 있다. 발행한 뒤에 보여
 * 주는 숫자는 통계이지 경고가 아니고, TASK-0073 4장이 요구한 것은 **무제한 정률
 * 쿠폰의 위험을 발행 전에 인지시키는 것**이다. 그래서 이 패널은 값이 바뀔 때마다
 * 다시 계산되고, 확인 다이얼로그(R1)가 같은 컴포넌트를 한 번 더 그린다.
 *
 * ## 부담 주체를 고르는 칸이 없다 (F2)
 *
 * 계약에 그 칸이 없기 때문이다 — `sellerId` 가 `null` 인 것이 곧 「플랫폼 부담」이고,
 * 부담 주체는 고르는 값이 아니라 파생되는 값이다(`createCouponRequestSchema`). 그
 * 대신 폼이 **문장으로** 말한다: 이 할인은 판매자 정산에서 차감되지 않는다.
 *
 * ## 서버가 거절하면 그 칸에 붙는다 (U2)
 *
 * 필드 이름이 계약의 이름과 같으므로(`form-schema.ts`), `details[].field` 가
 * `discountValue` 라고 말하면 그 입력 아래에 문장이 선다. 어느 칸도 가리키지 않는
 * 거절 — 권한이 없다든가 — 은 폼 위의 한 줄이 되고, 그 문장은 **부르는 쪽이** 만든다
 * (`describe`): 데모 관리자에게는 「실계정 관리자가 낸 쿠폰이라…」가 되어야 하는데,
 * 그 판단은 이 폼이 알 수 있는 것이 아니다.
 */

/** 거절된 저장이 `mapError` 로 가는 길. 메시지는 이미 배치가 끝난 상태다. */
class FormRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('coupon issue rejected')
    this.name = 'FormRejection'
  }
}

export interface CouponIssueFormProps {
  readonly messages: PlatformCouponMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 고를 수 있는 카테고리. 아직 도착하지 않았으면 빈 목록이다. */
  readonly categories: readonly CategoryChoice[]
  readonly categoriesLoading: boolean
  /** 성공하면 부르는 쪽이 목록으로 데려간다. 실패는 값으로 돌아온다. */
  readonly onSubmit: (request: CreateCouponRequest) => Promise<ApiFailure | null>
  /** 실패 하나를 이 화면의 문장으로. 폼 위에 서는 마지막 한 줄이 된다. */
  readonly describe: (failure: ApiFailure) => string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function CouponIssueForm({
  messages,
  errors,
  categories,
  categoriesLoading,
  onSubmit,
  describe,
}: CouponIssueFormProps) {
  const copy = messages.form
  const schema = useMemo(() => couponFormSchema(copy.errors), [copy.errors])
  const gate = useConfirm()

  const form = useForm<CreateCouponRequest>({
    schema,
    initialValues: EMPTY_COUPON_FORM,
    onSubmit: async (request) => {
      // R1 — **확인 없이는 실행되지 않는다.** 아니라고 답하면 여기서 끝나고, 폼은
      // 채워진 채 남는다.
      if (!(await gate.request())) return

      const failure = await onSubmit(request)

      if (failure !== null) throw new FormRejection(placed(failure))
    },
    mapError: (error) => (error instanceof FormRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  const { values, setValue } = form
  const discountType = asString(values.discountType)
  const scopeType = asString(values.scopeType) as OfferedScopeType

  /**
   * 서버의 거절을 칸 위에 놓는다.
   *
   * `code` 로 카탈로그를 먼저 보고, 앱이 모르는 코드일 때만 서버의 문장을 쓴다 —
   * 그 순서가 내부 어휘(`scopeIds`, 엔드포인트 이름)를 화면에서 밀어낸다.
   */
  function placed(failure: ApiFailure): ValidationErrors {
    return serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
      fields: [...COUPON_FORM_FIELDS],
      code: failure.kind === 'http' ? failure.code : null,
      messageForCode: (code, params) => errorMessage(errors, code, params),
      // 어느 칸도 가리키지 않는 거절은 폼 위의 한 줄이 된다. 그 문장은 이 화면 전체가
      // 아는 사실(데모인가)까지 반영해야 하므로 부르는 쪽에서 온다.
      fallbackMessage: describe(failure),
    })
  }

  const estimate = estimateCouponCost({
    discountType: discountType === 'FIXED' || discountType === 'PERCENT' ? discountType : null,
    discountValue: integerFrom(asString(values.discountValue)),
    maxDiscountAmount: integerFrom(asString(values.maxDiscountAmount)),
    issueLimit: integerFrom(asString(values.issueLimit)),
  })

  return (
    <div className="flex flex-col gap-4">
      {/*
        폼과 목록이 **같은 문장**을 쓴다 (F2). 이 화면을 처음 보는 사람이 알아야 할
        것은 지금 만드는 할인이 판매자 정산에서 차감되지 않는다는 사실이다.
      */}
      <p
        className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-sm"
        role="note"
      >
        {messages.burden.formNotice}
      </p>

      <Form aria-label={copy.title} form={form}>
        <FormError errors={form.formErrors} />

        <FormField form={form} label={copy.nameLabel} name="name" required>
          <Input {...form.text('name')} autoComplete="off" placeholder={copy.namePlaceholder} />
        </FormField>

        <FormField form={form} label={copy.discountTypeLabel} name="discountType" required>
          <Select
            {...form.choice('discountType')}
            onValueChange={(next) => {
              setValue('discountType', next)
              // 정액 할인에 상한은 **뜻이 없는 값**이라 서버가 거절한다
              // (`max_discount_meaningless`). 칸을 감추기만 하면 값은 상태에 남고,
              // 그 요청은 400 으로 끝난다.
              if (next === 'FIXED') setValue('maxDiscountAmount', '')
            }}
            options={couponDiscountTypes.map((type) => ({
              value: type,
              label: messages.discountTypeLabels[type],
            }))}
            placeholder={copy.discountTypeLabel}
          />
        </FormField>

        <FormField
          form={form}
          hint={
            discountType === 'FIXED' || discountType === 'PERCENT'
              ? copy.discountValueHints[discountType]
              : undefined
          }
          // 단위가 유형에 달렸다. 아직 고르지 않았으면 단위를 말할 수 없다.
          label={
            discountType === 'FIXED' || discountType === 'PERCENT'
              ? copy.discountValueLabels[discountType]
              : copy.discountValueLabel
          }
          name="discountValue"
          required
        >
          <Input {...form.text('discountValue')} inputMode="numeric" min={1} type="number" />
        </FormField>

        {/* 상한은 정률에만 뜻이 있다. 정액에 내면 서버가 거절할 칸을 그리는 셈이다. */}
        {discountType === 'PERCENT' ? (
          <FormField
            form={form}
            hint={copy.maxDiscountHint}
            label={copy.maxDiscountLabel}
            name="maxDiscountAmount"
          >
            <Input {...form.text('maxDiscountAmount')} inputMode="numeric" min={1} type="number" />
          </FormField>
        ) : null}

        <FormField
          form={form}
          hint={copy.minOrderHint}
          label={copy.minOrderLabel}
          name="minOrderAmount"
        >
          <Input {...form.text('minOrderAmount')} inputMode="numeric" min={0} type="number" />
        </FormField>

        <FormField
          form={form}
          hint={copy.scopeUnsupported}
          label={copy.scopeTypeLabel}
          name="scopeType"
          required
        >
          <Select
            {...form.choice('scopeType')}
            onValueChange={(next) => {
              setValue('scopeType', next)
              // 전체 적용 쿠폰에 대상이 실리면 서버가 거절한다
              // (`scope_targets_forbidden`). 고른 카테고리를 함께 버린다.
              if (next === 'ALL') setValue('scopeIds', '')
            }}
            options={OFFERED_SCOPE_TYPES.map((type) => ({
              value: type,
              label: messages.scopeTypeLabels[type],
            }))}
          />
        </FormField>

        {scopeType === 'CATEGORY' ? (
          <FormField
            form={form}
            hint={categoriesLoading ? copy.categoryLoading : undefined}
            label={copy.categoryLabel}
            name="scopeIds"
            required
          >
            <Select
              {...form.choice('scopeIds')}
              disabled={categories.length === 0}
              options={categories.map((choice) => ({
                value: String(choice.id),
                label: choice.path.join(copy.categorySeparator),
              }))}
              placeholder={copy.categoryPlaceholder}
            />
          </FormField>
        ) : null}

        <FormField form={form} label={copy.validFromLabel} name="validFrom" required>
          <Input {...form.text('validFrom')} type="date" />
        </FormField>

        <FormField
          form={form}
          hint={copy.periodHint}
          label={copy.validUntilLabel}
          name="validUntil"
          required
        >
          <Input {...form.text('validUntil')} type="date" />
        </FormField>

        <FormField
          form={form}
          hint={copy.issueLimitHint}
          label={copy.issueLimitLabel}
          name="issueLimit"
        >
          <Input {...form.text('issueLimit')} inputMode="numeric" min={1} type="number" />
        </FormField>

        <FormField form={form} hint={copy.withCodeHint} label={copy.withCodeLabel} name="withCode">
          <Checkbox {...form.toggle('withCode')} />
        </FormField>

        <CouponCostSummary estimate={estimate} messages={copy.cost} />

        <div className="flex justify-end">
          <Button loading={form.submitting} type="submit" variant="primary">
            {form.submitting ? copy.submitting : copy.submit}
          </Button>
        </div>
      </Form>

      {/*
        R1 — 실수로 과도한 쿠폰을 내는 것을 막는 마지막 자리. 여기서 다시 그리는
        비용이 폼에서 보던 그 값이라, 「확인」이 무엇을 확인하는지가 분명하다.
      */}
      <ConfirmDialog
        cancelLabel={copy.confirm.cancel}
        closeLabel={copy.confirm.closeLabel}
        confirmLabel={copy.confirm.confirm}
        description={copy.confirm.description}
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        size="md"
        title={copy.confirm.title}
      >
        <div className="flex flex-col gap-3">
          <CouponCostSummary estimate={estimate} messages={copy.cost} />
          <p className="text-fg-muted text-sm">{messages.burden.formNotice}</p>
        </div>
      </ConfirmDialog>
    </div>
  )
}
