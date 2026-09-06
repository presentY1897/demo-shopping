'use client'

import type { ApiFailure } from '@shopping/shared'
import { Button, Card, Input } from '@shopping/ui/components'
import { Form, FormError, FormField, useForm } from '@shopping/ui/form'
import { useMemo, useState } from 'react'

import type { CouponClaimFormValues } from '@/lib/coupons/claim-form-schema'
import { couponClaimFormSchema } from '@/lib/coupons/claim-form-schema'
import type { CouponClaimResult } from '@/lib/coupons/use-coupon-box'
import type { CouponClaimMessages, MyPageMessages } from '@/messages'

import { AccountWriteFailure } from './account-notices'

/**
 * 쿠폰 코드 등록 (TASK-0077 F3).
 *
 * **거절의 사유가 보여야 한다는 것이 F3 의 절반이다.** 서버는 일곱 가지로 갈라
 * 답하는데(`COUPON_CODE_UNKNOWN` · `COUPON_ALREADY_ISSUED` · …) 화면이 「쿠폰을 받지
 * 못했습니다」 하나로 덮으면, 그 갈림이 화면에서 사라진다 — 기다리면 되는 사람과
 * 포기해야 하는 사람이 같은 문장을 받는다. 그래서 `AccountWriteFailure` 를 쓴다:
 * 카탈로그의 문장이 먼저이고 서버 문장은 이 앱이 모르는 코드에만 나오는 순서를
 * `failureMessage` 가 이미 쥐고 있다 (TASK-0117).
 *
 * **목록 위에 늘 펼쳐져 있다.** 카드 발급 폼처럼 버튼으로 여는 길도 있었지만, 이
 * 화면에서 코드 등록은 「부수적인 관리 동작」이 아니라 **사람이 여기 오는 두 이유 중
 * 하나**다 — 받으러 왔거나 확인하러 왔다. 한 번 더 눌러야 나타나는 칸은 앞의 절반을
 * 뒤로 미룬다.
 *
 * **`type="text"` 다.** 코드는 숫자와 글자가 섞인 Crockford base32 이고, 대소문자를
 * 서버가 접어 주므로 `autoCapitalize` 도 강제하지 않는다 — 화면이 미리 대문자로
 * 바꾸면 「무엇을 쳤나」와 「무엇을 보냈나」가 갈린다.
 */
export function CouponClaimForm({
  copy,
  messages,
  onSubmit,
}: {
  readonly copy: CouponClaimMessages
  readonly messages: MyPageMessages
  readonly onSubmit: (code: string) => Promise<CouponClaimResult>
}) {
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const schema = useMemo(() => couponClaimFormSchema(copy.errors), [copy.errors])

  const form = useForm<CouponClaimFormValues>({
    schema,
    initialValues: { code: '' },
    onSubmit: async (values) => {
      setFailure(null)

      const result = await onSubmit(values.code)

      if (!result.ok) {
        setFailure(result.failure)
        // 던져야 `useForm` 이 실패 경로를 탄다: 친 코드가 칸에 남고 폼이 초기화되지
        // 않는다. 거절당한 사람에게 코드를 다시 치게 만드는 것은 실패에 대한 벌이고,
        // 「이미 받은 쿠폰」처럼 **다시 칠 이유가 없는** 거절에서는 특히 그렇다.
        throw new CouponClaimRejection(result.failure)
      }
    },
    submitErrorMessage: copy.submitError,
  })

  return (
    <Card as="article" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <Form aria-label={copy.title} form={form}>
        <FormError errors={form.formErrors} />

        <FormField form={form} hint={copy.codeHint} label={copy.codeLabel} name="code" required>
          <Input
            {...form.text('code')}
            autoComplete="off"
            // 코드를 화면이 다듬지 않는다. 서버가 접어 주는 것을 브라우저가 미리
            // 하면 사람이 친 값과 보낸 값이 갈린다.
            autoCorrect="off"
            placeholder={copy.codePlaceholder}
            spellCheck={false}
          />
        </FormField>

        <div className="flex justify-end">
          <Button loading={form.submitting} type="submit" variant="primary">
            {form.submitting ? copy.submitting : copy.submit}
          </Button>
        </div>
      </Form>

      {failure === null ? null : (
        <AccountWriteFailure failure={failure} messages={messages} title={copy.submitError} />
      )}
    </Card>
  )
}

class CouponClaimRejection extends Error {
  constructor(readonly failure: ApiFailure) {
    super('coupon claim rejected')
    this.name = 'CouponClaimRejection'
  }
}
