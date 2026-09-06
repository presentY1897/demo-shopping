'use client'

import type { ApiFailure, CommissionRate, SetCommissionRateRequest } from '@shopping/shared'
import { commissionScopes, errorMessage } from '@shopping/shared'
import type { ErrorMessages } from '@shopping/shared'
import { Button, GuardedButton, Input, Radio, RadioGroup, Select } from '@shopping/ui/components'
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
import { commissionPercent } from '@/lib/commissions/format'
import {
  COMMISSION_FORM_FIELDS,
  commissionFormSchema,
  EMPTY_COMMISSION_FORM,
} from '@/lib/commissions/form-schema'
import { rateBpFromPercent } from '@/lib/commissions/rate-bp'
import type { CommissionScopeSelection } from '@/lib/commissions/scopes'
import { openRateFor, selectedScope } from '@/lib/commissions/scopes'
import { categoryTargetName, sellerTargetName } from '@/lib/commissions/targets'
import type { CommissionMutationResult } from '@/lib/commissions/use-commissions'
import { useCommissionHistory, useCommissionSimulation } from '@/lib/commissions/use-commissions'
import type { SellerChoicesState } from '@/lib/commissions/use-sellers'
import type { CommissionMessages } from '@/messages'

import { CommissionHistoryTable } from './commission-history-table'
import { CommissionSimulationPanel } from './commission-simulation-panel'

/**
 * 한 범위를 고르고, 그 범위에 대해 알 수 있는 것을 전부 보는 자리.
 *
 * ## 범위 선택이 하나뿐인 이유
 *
 * 지금 요율·미리보기·이력·저장은 전부 「어느 자리의 요율인가」에 딸린 것들이다.
 * 각자 자기 선택기를 가지면 화면에 범위 선택이 넷이 되고, 그중 셋이 서로 다른 것을
 * 가리키는 순간 읽는 사람은 자기가 무엇을 바꾸려는지 알 수 없다. 하나를 고르면
 * 네 자리가 함께 움직인다.
 *
 * 그래서 범위가 **폼 안에** 있다. 저장 요청이 실어 보내는 값이기도 하고, 고르지 않은
 * 채 저장을 누르면 거절이 그 칸 밑에 서야 하기 때문이다 (`form-schema.ts`).
 *
 * ## 미리보기가 폼 안에 있는 이유 (F6)
 *
 * 저장한 뒤에 보여 주는 숫자는 통계이지 경고가 아니다. 요율은 **모든 판매자의 다음
 * 정산 금액**을 한 번에 옮기는 값이라(`permissions.ts` 의 `commission.write`), 그
 * 크기는 누르기 전에 보여야 뜻이 있다. 확인 다이얼로그가 같은 컴포넌트를 한 번 더
 * 그리는 것도 같은 이유다 — 확인 직전에 보는 숫자와 폼에서 보던 숫자가 다르면 확인은
 * 확인이 아니다.
 *
 * ## 못 바꾸는 계정에게도 전부 보인다 (F7)
 *
 * 운영자와 데모 관리자는 `commission.read` 만 갖는다(`role-permissions.ts` — 거절은
 * 조건문이 아니라 권한 목록의 **빈자리**가 만든다). 그들에게 이 절을 감추면 콘솔이
 * 실제보다 적은 기능을 가진 것처럼 보이고, 무엇을 요청해야 하는지도 알 수 없다.
 * 그래서 범위·요율·미리보기는 그대로 살아 있고 **저장 버튼 하나만** 막힌다 —
 * 회색으로 죽이는 대신 키보드가 닿는 자리에 두고 이유를 말한다 (TASK-0023 4장).
 */

export interface CommissionScopePanelProps {
  readonly messages: CommissionMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 지금 열려 있는 요율 전부. 고른 범위의 「지금 요율」이 여기서 나온다. */
  readonly rates: readonly CommissionRate[]
  /** 아무 요율도 없을 때 쓰이는 값. 목록이 아직 오지 않았으면 `null` 이다. */
  readonly fallbackRateBp: number | null
  readonly categories: readonly CategoryChoice[]
  readonly categoriesLoading: boolean
  readonly sellers: SellerChoicesState
  readonly onSave: (request: SetCommissionRateRequest) => Promise<CommissionMutationResult>
  /** 저장이 끝난 뒤 부르는 쪽에 알린다 — 토스트는 화면 전체의 것이다. */
  readonly onSaved: (scopeName: string, rateBp: number) => void
  /** 이 계정이 왜 못 바꾸는지, 또는 바꿀 수 있으면 `undefined`. */
  readonly writeDenial: string | undefined
  readonly describe: (failure: ApiFailure) => string
}

/** 거절된 저장이 `mapError` 로 가는 길. 메시지는 이미 배치가 끝난 상태다. */
class SaveRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('commission rate rejected')
    this.name = 'SaveRejection'
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function CommissionScopePanel({
  messages,
  errors,
  rates,
  fallbackRateBp,
  categories,
  categoriesLoading,
  sellers,
  onSave,
  onSaved,
  writeDenial,
  describe,
}: CommissionScopePanelProps) {
  const copy = messages.editor
  const schema = useMemo(() => commissionFormSchema(copy.errors), [copy.errors])
  const gate = useConfirm()

  // `save` 는 함수 선언이라 여기서 이미 정의되어 있다. 폼이 들고 있는 값에서
  // 파생되는 것들(범위·이력·미리보기)이 그 아래에 있어야 읽히므로, 순서를 위해
  // 화살표 함수를 쓰지 않았다.
  const form = useForm<SetCommissionRateRequest>({
    schema,
    initialValues: EMPTY_COMMISSION_FORM,
    onSubmit: save,
    mapError: (error) => (error instanceof SaveRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  const { values } = form
  const kind = asString(values.scope)
  const categoryValue = asString(values.categoryId)
  const sellerValue = asString(values.sellerId)
  const ratePercent = asString(values.ratePercent)

  /**
   * 지금 고른 범위. **객체를 붙잡아 둔다** — 이력과 미리보기가 이것을 의존성으로
   * 쓰므로, 렌더마다 새 객체를 만들면 요청이 끝없이 다시 나간다.
   */
  const scope = useMemo(
    () => selectedScope(kind, categoryValue, sellerValue),
    [kind, categoryValue, sellerValue],
  )

  const parsedRate = rateBpFromPercent(ratePercent)
  const proposedRateBp = parsedRate.ok ? parsedRate.rateBp : null

  const simulation = useCommissionSimulation(scope, proposedRateBp)
  const history = useCommissionHistory(scope)

  const current = scope === null ? null : openRateFor(rates, scope)
  const scopeName = scopeNameOf(scope, categories, sellers, messages)

  async function save(request: SetCommissionRateRequest): Promise<void> {
    // **확인 없이는 실행되지 않는다.** 아니라고 답하면 여기서 끝나고, 폼은 채워진
    // 채 남는다.
    if (!(await gate.request())) return

    const result = await onSave(request)

    if (!result.ok) throw new SaveRejection(placed(result.failure))

    // 이력은 이 절의 것이라 이 절이 다시 읽는다. 목록을 다시 읽는 것은 부르는 쪽의
    // 몫이다 — 바뀐 것은 이 줄만이 아니라 어느 범위가 어느 범위를 이기는가이므로.
    history.reload()
    onSaved(scopeName, request.rateBp)
  }

  /**
   * 서버의 거절을 칸 위에 놓는다.
   *
   * `code` 로 카탈로그를 먼저 보고, 앱이 모르는 코드일 때만 서버의 문장을 쓴다 —
   * 그 순서가 내부 어휘를 화면에서 밀어낸다. 어느 칸도 가리키지 않는 거절은 폼 위의
   * 한 줄이 된다.
   */
  function placed(failure: ApiFailure): ValidationErrors {
    return serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
      fields: [...COMMISSION_FORM_FIELDS],
      code: failure.kind === 'http' ? failure.code : null,
      messageForCode: (code, params) => errorMessage(errors, code, params),
      fallbackMessage: describe(failure),
    })
  }

  const sellerOptions =
    sellers.status === 'ready'
      ? sellers.choices.map((choice) => ({ value: choice.id, label: choice.name }))
      : []

  return (
    <section aria-label={copy.title} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg text-base font-medium">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <Form aria-label={copy.title} form={form}>
        <FormError errors={form.formErrors} />

        <FormField form={form} label={copy.scopeLabel} name="scope" required variant="group">
          <RadioGroup {...form.choice('scope')} orientation="horizontal">
            {commissionScopes.map((value) => (
              <Radio key={value} label={messages.scopeLabels[value]} value={value} />
            ))}
          </RadioGroup>
        </FormField>

        {/*
          고른 범위에 필요한 칸만 낸다. 둘 다 내면 「카테고리별」을 고른 사람에게도
          판매자 셀렉트가 서고, 계약은 둘이 함께 실린 요청을 거절한다.
        */}
        {kind === 'category' ? (
          <FormField
            form={form}
            hint={categoriesLoading ? copy.categoryLoading : undefined}
            label={copy.categoryLabel}
            name="categoryId"
            required
          >
            <Select
              {...form.choice('categoryId')}
              options={categories.map((choice) => ({
                value: String(choice.id),
                label: choice.path.join(messages.open.categorySeparator),
              }))}
              placeholder={copy.categoryPlaceholder}
            />
          </FormField>
        ) : null}

        {kind === 'seller' ? (
          <FormField
            form={form}
            hint={sellers.status === 'loading' ? copy.sellerLoading : copy.sellerNotice}
            label={copy.sellerLabel}
            name="sellerId"
            required
          >
            <Select
              {...form.choice('sellerId')}
              options={sellerOptions}
              placeholder={copy.sellerPlaceholder}
            />
          </FormField>
        ) : null}

        {/*
          목록을 못 받았을 때. 셀렉트를 빈 채로 두면 「이 플랫폼에 스토어가 없다」로
          읽히고, 전역·카테고리 요율까지 못 바꾸는 줄 알게 된다.
        */}
        {kind === 'seller' && sellers.status === 'error' ? (
          <p className="text-fg-muted text-sm" role="note">
            {copy.sellerUnavailable}
          </p>
        ) : null}

        {/*
          「지금 요율」은 폼의 칸이 아니라 사실이다. 입력 바로 위에 서는 이유는 새
          요율을 적는 사람이 무엇을 대체하는지 알아야 하기 때문이고, 아직 아무것도
          없을 때 폴백을 적는 이유는 그때도 **수수료는 걷히고 있기** 때문이다.
        */}
        {current === null ? (
          // 폴백을 아직 모르면 아무 말도 하지 않는다. 그 자리에 `0%` 를 그리면
          // 목록이 오는 동안 「수수료를 받지 않는다」가 화면에 나타난다.
          fallbackRateBp === null ? null : (
            <p className="text-fg-muted text-sm">
              {copy.currentUnset.replace('{rate}', commissionPercent(fallbackRateBp))}
            </p>
          )
        ) : (
          <p className="text-fg-muted text-sm">
            {copy.currentLabel.replace('{rate}', commissionPercent(current.rateBp))}
          </p>
        )}

        <FormField
          form={form}
          hint={copy.rateHint}
          label={copy.rateLabel}
          name="ratePercent"
          required
        >
          <Input
            {...form.text('ratePercent')}
            autoComplete="off"
            inputMode="decimal"
            placeholder={copy.ratePlaceholder}
          />
        </FormField>

        <CommissionSimulationPanel
          describe={describe}
          messages={messages.simulation}
          state={simulation}
        />

        <div className="flex justify-end">
          {writeDenial === undefined ? (
            <Button loading={form.submitting} type="submit" variant="primary">
              {form.submitting ? copy.submitting : copy.submit}
            </Button>
          ) : (
            <GuardedButton blocked reason={writeDenial} type="submit" variant="primary">
              {copy.submit}
            </GuardedButton>
          )}
        </div>
      </Form>

      <ConfirmDialog
        cancelLabel={copy.confirm.cancel}
        closeLabel={copy.confirm.closeLabel}
        confirmLabel={copy.confirm.confirm}
        description={copy.confirm.description
          .replace('{scope}', scopeName)
          .replace('{rate}', proposedRateBp === null ? '' : commissionPercent(proposedRateBp))}
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        size="md"
        title={copy.confirm.title}
      >
        <CommissionSimulationPanel
          describe={describe}
          messages={messages.simulation}
          state={simulation}
        />
      </ConfirmDialog>

      <CommissionHistoryTable
        describe={describe}
        messages={messages.history}
        onRetry={history.reload}
        state={history.state}
      />
    </section>
  )
}

/**
 * 고른 범위를 부르는 이름 — 확인 문구와 토스트가 같은 말을 쓰기 위해.
 *
 * 아직 완결되지 않은 범위는 범위의 **종류**로 부른다. 그 상태에서는 저장이 거절되고,
 * 이름이 쓰이는 곳은 저장이 끝난 뒤의 두 자리뿐이다.
 */
function scopeNameOf(
  scope: CommissionScopeSelection | null,
  categories: readonly CategoryChoice[],
  sellers: SellerChoicesState,
  messages: CommissionMessages,
): string {
  if (scope === null) return messages.scopeLabels.category
  if (scope.kind === 'global') return messages.scopeLabels.global
  if (scope.kind === 'category') {
    return categoryTargetName(categories, scope.categoryId, messages.open)
  }

  return sellerTargetName(
    sellers.status === 'ready' ? sellers.choices : [],
    scope.sellerId,
    messages.open,
  )
}
