'use client'

import type { ApiFailure, ErrorMessages, ProductSummary } from '@shopping/shared'
import { failureMessage, grantedScopes, platformOwnership } from '@shopping/shared'
import {
  Button,
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import { ConfirmDialog } from '@shopping/ui/form'
import { useCallback, useMemo, useState } from 'react'

import type { ModerationAction } from '@/lib/catalog/product-console'
import { productRefusalOf } from '@/lib/catalog/product-console'
import { useCategoryChoices, useProducts } from '@/lib/catalog/use-products'
import { useAuth } from '@/lib/auth/auth-context'
import { useAuthorization } from '@/lib/auth/authorization'
import { useStoreChoices } from '@/lib/stores/use-stores'
import type { AdminProductMessages } from '@/messages'

import { ProductFilters } from './product-filters'
import { ProductHideDialog } from './product-hide-dialog'
import { ProductTable } from './product-table'

/**
 * `/products` — 모든 스토어의 상품, 그리고 강제로 내리기 (TASK-0095).
 *
 * ## 볼 수 있는 자격과 바꿀 수 있는 자격이 **다르다**
 *
 * 목록은 `product.read` 를 **`any` 로** 든 사람의 것이다 — `product.read` 자체는
 * 구매자도 갖고 있고 `own` 으로 좁혀져 있을 뿐이라, 화면은 서버와 같은 질문을
 * `platformOwnership` 으로 던진다 (`product.service.ts` 의 `list`).
 *
 * 내리기는 `catalog.write` 이고, **데모 관리자에게는 그것이 `demo` 로 좁혀져 있다**
 * (F8 · D-058).
 *
 * ## 그런데 버튼을 미리 죽일 수 없다
 *
 * 좁혀진 스코프의 판정은 「이 상품의 주인이 데모 계정인가」로 하는데, **그 사실이
 * 목록의 줄에 없다** — `productSummarySchema` 에 `ownerIsDemo` 가 없다. 심사 콘솔이
 * 같은 자리에서 같은 판단을 했다 (TASK-0110 4장 R4): 줄마다 짐작하면 데모 관리자에게
 * 자기 상품까지 막거나 실계정 상품을 약속하게 된다.
 *
 * 그래서 화면은 **할 수 있는 참말**을 한다 — 계정 전체가 데모로 좁혀져 있으면 그
 * 사실을 미리 말하고, 실제로 오는 403 은 문장으로 세운다 (`refusals.forbidden`).
 *
 * ## 내린 뒤에 목록을 다시 읽는 것은 훅의 일이다
 *
 * 답은 숨김 여부만 싣고 줄이 들고 있는 것은 `status` 라, 화면이 둘을 이어 붙이면
 * 어긋날 수 있다 (`use-products.ts`).
 */

export interface ProductListWorkspaceProps {
  readonly messages: AdminProductMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function ProductListWorkspace({ messages, errors }: ProductListWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  if (!canOn('product.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('product.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <ProductConsole errors={errors} messages={messages} />
    </ToastProvider>
  )
}

function ProductConsole({ messages, errors }: ProductListWorkspaceProps) {
  const products = useProducts()
  const stores = useStoreChoices()
  const categories = useCategoryChoices()
  const { toast } = useToast()
  const { subject } = useAuth()

  /** 조치를 기다리는 줄, 그리고 그것이 어느 쪽인가. */
  const [pending, setPending] = useState<{
    readonly product: ProductSummary
    readonly action: ModerationAction
  } | null>(null)

  /** 창 밖에서 받은 거절. 사람이 닫을 때까지 남는다. */
  const [refused, setRefused] = useState<string | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  /**
   * 쓰기의 거절을 문장으로.
   *
   * 카탈로그가 이미 문장을 갖고 있는 코드는 그대로 두고(409
   * `PRODUCT_NOT_MODERATABLE`), 카탈로그가 말할 수 없는 둘만 이 화면의 문장으로
   * 바꾼다 — 「권한이 없어요」는 **어느 자격이 어떻게 좁혀져 있는지**를 말하지 못한다.
   */
  const describeWrite = useCallback(
    (value: ApiFailure): string => {
      const refusal = productRefusalOf(value)

      return refusal === null ? describe(value) : messages.refusals[refusal]
    },
    [describe, messages.refusals],
  )

  const { state, pagination, filters } = products
  const rows = state.status === 'ready' ? state.products : []

  const storeNames = useMemo(
    () =>
      new Map(
        stores.status === 'ready' ? stores.choices.map((store) => [store.id, store.name]) : [],
      ),
    [stores],
  )

  const categoryNames = useMemo(
    () =>
      new Map(
        categories.status === 'ready'
          ? categories.choices.map((category) => [category.id, category.label])
          : [],
      ),
    [categories],
  )

  /**
   * 이 계정의 `catalog.write` 가 **전부 데모로 좁혀져 있는가** — 곧 `DEMO_ADMIN` 이다.
   *
   * 계정에 대한 질문이라 답할 수 있다. 줄에 대한 같은 질문은 답할 수 없다(위의 머리말).
   */
  const writeScopes = subject === null ? [] : grantedScopes(subject, 'catalog.write')
  const demoScoped = writeScopes.length > 0 && writeScopes.every((scope) => scope === 'demo')

  /** 사유를 받아 실제로 내리는 자리. 성공하면 `null`, 아니면 그 실패를 창이 그린다. */
  async function hide(reason: string): Promise<ApiFailure | null> {
    if (pending === null) return null

    const result = await products.hide(pending.product.id, reason)

    // 이미 도는 중이었다 — 아무것도 보내지 않았고, 말할 것도 없다.
    if (result === null) return null

    if (!result.ok) return result.failure

    setPending(null)
    toast({ title: messages.toast.hidden, variant: 'success' })

    return null
  }

  async function restore(): Promise<void> {
    if (pending === null) return

    const result = await products.restore(pending.product.id)

    setPending(null)

    if (result === null) return

    if (result.ok) {
      toast({ title: messages.toast.restored, variant: 'success' })

      return
    }

    // 확인 대화상자에는 실패를 앉힐 자리가 없다(`ConfirmDialog` 의 규약). 사라지는
    // 토스트 대신 남는 문장으로 세우는 이유는, 「왜 안 됐는가」가 다시 눌러 볼 만한
    // 것이 아니기 때문이다.
    setRefused(describeWrite(result.failure))
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 계정 전체가 데모로 좁혀져 있다는, 줄을 보지 않고도 할 수 있는 참말 (F8). */}
      {demoScoped ? (
        <p className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-sm">
          {messages.refusals.forbidden}
        </p>
      ) : null}

      {refused === null ? null : (
        <div
          className="border-danger bg-danger-surface text-fg flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
          role="alert"
        >
          <p>{refused}</p>
          <Button
            onClick={() => {
              setRefused(null)
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {messages.dismissLabel}
          </Button>
        </div>
      )}

      <ProductFilters
        categories={categories}
        disabled={state.status === 'loading'}
        messages={messages.list}
        onChange={products.setFilters}
        statusLabels={messages.statusLabels}
        stores={stores}
        value={filters}
      />

      <DataList
        empty={
          products.narrowed ? (
            <EmptyState
              description={messages.list.filteredEmptyDescription}
              title={messages.list.filteredEmptyTitle}
            />
          ) : (
            <EmptyState
              description={messages.list.emptyDescription}
              title={messages.list.emptyTitle}
            />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={products.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <ProductTable
          busy={products.busy}
          categoryNames={categoryNames}
          messages={messages.list}
          onModerate={(product, action) => {
            setRefused(null)
            setPending({ action, product })
          }}
          rows={rows}
          statusLabels={messages.statusLabels}
          storeNames={storeNames}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.list.pagination.label}
          nextLabel={messages.list.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.list.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, rows.length)}
        />
      </DataList>

      {pending?.action === 'hide' ? (
        <ProductHideDialog
          describe={describeWrite}
          errors={errors}
          messages={messages}
          onCancel={() => {
            setPending(null)
          }}
          onConfirm={hide}
          target={pending.product}
        />
      ) : null}

      {pending?.action === 'restore' ? (
        <ConfirmDialog
          cancelLabel={messages.restore.cancel}
          closeLabel={messages.restore.closeLabel}
          confirmLabel={messages.restore.confirm}
          description={messages.restore.description}
          onConfirm={restore}
          onOpenChange={(next) => {
            if (!next) setPending(null)
          }}
          open
          title={messages.restore.title}
        >
          <dl className="border-border grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
            <dt className="text-fg-muted">{messages.restore.targetLabel}</dt>
            <dd className="text-fg">{pending.product.name}</dd>
          </dl>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}

/**
 * `2 페이지 · 20개`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는
 * 것이 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다.
 */
function pageStatus(messages: AdminProductMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
