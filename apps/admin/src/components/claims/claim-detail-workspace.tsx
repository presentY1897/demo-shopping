'use client'

import type { ApiFailure, Claim, ClaimItem, ErrorMessages } from '@shopping/shared'
import { errorMessage, failureMessage, grantedScopes } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorState,
  linkClassName,
  Skeleton,
  Table,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import NextLink from 'next/link'
import { useCallback, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { useAuthorization } from '@/lib/auth/authorization'
import type { ForceInput } from '@/lib/claims/claim-console'
import { interventionBlockOf } from '@/lib/claims/claim-console'
import { claimDateTime, shortId } from '@/lib/claims/format'
import { useAdminClaim } from '@/lib/claims/use-admin-claim'
import type { AdminClaimMessages, ErrorNoticeMessages } from '@/messages'

import { AppealDismissDialog } from './appeal-dismiss-dialog'
import { ClaimForceDialog } from './claim-force-dialog'

/**
 * `/claims/[id]` — 한 건과, 관리자가 그것에 대해 할 수 있는 일.
 *
 * ## 「처리할 수 없다」를 **문장으로** 말하는 화면
 *
 * 이 화면에는 비활성 버튼이 없다. 누를 수 없는 이유가 셋인데 셋 다 버튼으로는 말할 수
 * 없기 때문이다 (TASK-0063 4.1 · 이 TASK 의 보고).
 *
 * | 왜 못 누르나 | 화면이 하는 일 |
 * | --- | --- |
 * | 이 상태는 뒤집을 것이 없다 | 버튼 대신 **왜 지금이 아닌지**를 적는다 (`blocked.state`) |
 * | 이 역할에 처리 권한이 없다 | 같은 자리에 어느 권한이 없는지까지 적는다 |
 * | 데모 관리자인데 이 건이 실계정의 것이다 | **미리 알 수 없다.** 눌러 보기 전에는 계정에 대한 사실만 말하고, 서버가 403 으로 답하면 그 답을 이 건에 대한 문장으로 바꾼다 |
 *
 * 세 번째가 이 화면의 판단이다. 응답 어디에도 「데모 계정이 만든 건인가」가 없으므로
 * (`claimSchema` 에 소유자 표시가 없다), 줄마다 잠그는 것은 **추측**이고 그 추측은 둘 중
 * 한 방향으로 틀린다 — 처리할 수 있는 건을 잠그거나, 처리할 수 없는 건을 열어 준다.
 * 눌러서 거절당하고 **그 이유를 문장으로 읽는 것**이, 눌리지 않는 회색 버튼에 툴팁이
 * 달린 것보다 F5 가 재려는 것(처리 못 함 + 이유가 보임)에 가깝다.
 *
 * ## 개입은 새 클레임이고, 둘은 서로를 가리킨다 (F6)
 *
 * 강제 처리는 원본을 되살리지 않는다. 원본은 거절된 채 남고 개입이 옆에 선다. 화면이
 * 그 관계를 **양쪽에서** 그리는 이유는 한쪽만 그리면 남은 쪽이 고아로 읽히기
 * 때문이다 — 판매자는 자기 거절이 살아 있는 줄 알고, 관리자는 이 승인이 어디서 왔는지
 * 모른다. 「누가·왜·언제」는 이력 표가 담는다.
 */

export interface ClaimDetailWorkspaceProps {
  readonly claimId: string
  readonly messages: AdminClaimMessages
  readonly errors: ErrorMessages
  readonly notice: ErrorNoticeMessages
}

export function ClaimDetailWorkspace(props: ClaimDetailWorkspaceProps) {
  const { detail } = props.messages

  return (
    <ToastProvider closeLabel={detail.toast.closeLabel} regionLabel={detail.toast.regionLabel}>
      <ClaimDetailScreen {...props} />
    </ToastProvider>
  )
}

/** 열려 있는 대화상자. 둘이 동시에 열릴 일은 없다. */
type OpenDialog = 'force' | 'dismiss' | null

function ClaimDetailScreen({ claimId, messages, errors, notice }: ClaimDetailWorkspaceProps) {
  const claim = useAdminClaim(claimId)
  const { can, reason } = useAuthorization()
  const { subject } = useAuth()
  const { toast } = useToast()

  const [dialog, setDialog] = useState<OpenDialog>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  /**
   * 서버가 이 건에 대해 「스코프 밖」이라고 답했다. 문장이 버튼을 대신한다.
   *
   * 답이 **온** 실패만 여기 앉는다(`http`). 닿지도 못한 요청은 이 건에 대한 판정이
   * 아니라 네트워크의 일이고, 그것으로 버튼을 치우면 잠시 뒤 다시 눌러야 할 사람에게
   * 「처리할 수 없는 건」이라고 말하게 된다.
   */
  const [refused, setRefused] = useState<Extract<ApiFailure, { kind: 'http' }> | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { detail, vocabulary, appeal: appealCopy } = messages
  const ready = claim.state.status === 'ready' ? claim.state.claim : null

  const handleScopes = subject === null ? [] : grantedScopes(subject, 'claim.handle')
  const demoScoped = handleScopes.length > 0 && handleScopes.every((scope) => scope === 'demo')
  const mayHandle = can('claim.handle')

  /**
   * 쓰기 하나의 결말을 화면에 앉힌다.
   *
   * 403 만 따로 잡는 이유는 그것이 **이 건에 대한 답**이기 때문이다. 다른 실패는 다시
   * 시도할 수 있는 일이지만 스코프 거절은 다시 눌러도 같은 답이 오고, 그때 필요한 것은
   * 오류 배너가 아니라 **버튼이 사라진 자리의 설명**이다.
   */
  function settle(result: { readonly ok: boolean; readonly failure?: ApiFailure } | null): boolean {
    // 아무것도 보내지 않았다 — 이미 도는 중인 요청 위에 두 번째 클릭이 온 것이다.
    if (result === null) return false

    if (result.ok) {
      setDialog(null)
      setFailure(null)

      return true
    }

    const value = result.failure

    if (value?.kind === 'http' && value.status === 403) {
      setDialog(null)
      setFailure(null)
      setRefused(value)

      return false
    }

    setFailure(value ?? null)

    return false
  }

  async function force(input: ForceInput): Promise<void> {
    const result = await claim.force(input)

    if (settle(result)) toast({ title: detail.toast.forced, variant: 'success' })
  }

  async function dismiss(text: string): Promise<void> {
    const result = await claim.dismissAppeal(text)

    if (settle(result)) toast({ title: detail.toast.dismissed, variant: 'success' })
  }

  const itemColumns: readonly TableColumn<ClaimItem>[] = [
    { key: 'product', header: detail.items.product, cell: (row) => row.snapshot.productName },
    {
      key: 'option',
      header: detail.items.option,
      cell: (row) =>
        row.snapshot.optionLabel === '' ? detail.items.noOption : row.snapshot.optionLabel,
    },
    { key: 'sku', header: detail.items.sku, cell: (row) => row.snapshot.sku },
    { key: 'quantity', header: detail.items.quantity, numeric: true, cell: (row) => row.quantity },
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <NextLink className={linkClassName()} href="/claims">
            {detail.backLabel}
          </NextLink>
          <h1 className="text-fg text-2xl font-bold">{detail.title}</h1>
          {ready === null ? null : (
            <p className="text-fg-muted text-sm">
              {detail.subtitle.replace('{orderNumber}', ready.orderNumber)}
            </p>
          )}
        </div>
        {ready === null ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{vocabulary.typeLabels[ready.type]}</Badge>
            <Badge variant="neutral">{vocabulary.statusLabels[ready.status]}</Badge>
            {ready.overturnsClaimId === null ? null : (
              <Badge variant="primary">{messages.list.badges.intervention}</Badge>
            )}
            {ready.appeal !== null && ready.appeal.reviewedAt === null ? (
              <Badge variant="warning">{messages.list.badges.appealPending}</Badge>
            ) : null}
          </div>
        )}
      </header>

      <DataList
        empty={<EmptyState description={detail.notFoundDescription} title={detail.notFoundTitle} />}
        error={
          <ErrorState
            description={claim.state.status === 'error' ? describe(claim.state.failure) : undefined}
            onRetry={claim.reload}
            retryLabel={detail.retryLabel}
            title={detail.errorTitle}
          />
        }
        loading={<Skeleton label={detail.loadingLabel} lines={8} />}
        state={
          claim.state.status === 'missing'
            ? 'empty'
            : claim.state.status === 'ready'
              ? 'ready'
              : claim.state.status
        }
      >
        {ready === null ? null : (
          <div className="flex flex-col gap-6">
            <section aria-label={detail.sections.actions} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{detail.sections.actions}</h2>

              <ClaimActions
                claim={ready}
                demoScoped={demoScoped}
                mayHandle={mayHandle}
                messages={messages}
                onDismiss={() => {
                  setFailure(null)
                  setDialog('dismiss')
                }}
                onForce={() => {
                  setFailure(null)
                  setDialog('force')
                }}
                permissionReason={reason('claim.handle')}
                refused={refused}
                refusedSentence={
                  refused === null
                    ? undefined
                    : demoScoped
                      ? messages.scope.outOfScope
                      : (errorMessage(errors, refused.code) ?? refused.message)
                }
              />
            </section>

            <section aria-label={detail.sections.summary} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{detail.sections.summary}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-fg-muted">{detail.summary.orderNumber}</dt>
                <dd>{ready.orderNumber}</dd>
                <dt className="text-fg-muted">{detail.summary.type}</dt>
                <dd>{vocabulary.typeLabels[ready.type]}</dd>
                <dt className="text-fg-muted">{detail.summary.status}</dt>
                <dd>{vocabulary.statusLabels[ready.status]}</dd>
                <dt className="text-fg-muted">{detail.summary.fault}</dt>
                <dd>{vocabulary.faultLabels[ready.fault]}</dd>
                {/* 목록과 같은 규약이다 — 개인정보 대신 계정 식별자가 온다. */}
                <dt className="text-fg-muted">{detail.summary.requestedBy}</dt>
                <dd title={ready.requestedById}>{shortId(ready.requestedById)}</dd>
                <dt className="text-fg-muted">{detail.summary.requestedAt}</dt>
                <dd>{claimDateTime(ready.requestedAt)}</dd>
                <dt className="text-fg-muted">{detail.summary.updatedAt}</dt>
                <dd>{claimDateTime(ready.updatedAt)}</dd>
              </dl>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{detail.sections.items}</h2>
              <Table
                caption={detail.items.caption}
                columns={itemColumns}
                rowKey={(row) => row.id}
                rows={ready.items}
                sort={null}
              />
            </section>

            <section aria-label={detail.sections.request} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{detail.sections.request}</h2>
              <p className="text-fg text-sm whitespace-pre-wrap">{ready.reason}</p>
            </section>

            <AppealPanel appeal={ready.appeal} messages={messages} />

            <InterventionPanel claim={ready} messages={messages} />

            <section aria-label={detail.sections.history} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{detail.sections.history}</h2>
              {ready.history.length === 0 ? (
                <p className="text-fg-muted text-sm">{detail.history.empty}</p>
              ) : (
                <Table
                  caption={detail.history.caption}
                  columns={[
                    {
                      key: 'at',
                      header: detail.history.at,
                      cell: (row) => claimDateTime(row.occurredAt),
                    },
                    {
                      key: 'change',
                      header: detail.history.change,
                      cell: (row) =>
                        row.fromStatus === null
                          ? detail.history.created
                          : detail.history.step
                              .replace('{from}', vocabulary.statusLabels[row.fromStatus])
                              .replace('{to}', vocabulary.statusLabels[row.toStatus]),
                    },
                    {
                      key: 'actor',
                      // **누가 판단했는가.** 분쟁에서 근거가 되는 것이 이 칸이다 (F6).
                      header: detail.history.actor,
                      cell: (row) => vocabulary.actorLabels[row.actor],
                    },
                    {
                      key: 'reason',
                      header: detail.history.reason,
                      cell: (row) => row.reason ?? detail.history.noReason,
                    },
                  ]}
                  rowKey={(row) => row.id}
                  rows={ready.history}
                  sort={null}
                />
              )}
            </section>
          </div>
        )}
      </DataList>

      {dialog === 'force' && ready !== null ? (
        <ClaimForceDialog
          busy={claim.busy}
          claim={ready}
          describe={describe}
          detail={detail}
          failure={failure}
          messages={messages.force}
          notice={notice}
          // 사진 칸의 문구는 확정 후 하자 반품 탭과 **같은 한 벌**이다. 서버가 두
          // 화면에 같은 것을 요구하므로(`returnPhotoDecision`) 문구도 갈라지지 않는다.
          photoMessages={messages.defectReturn.form}
          onCancel={() => {
            setDialog(null)
            setFailure(null)
          }}
          onConfirm={(input) => {
            void force(input)
          }}
          vocabulary={vocabulary}
        />
      ) : null}

      {dialog === 'dismiss' ? (
        <AppealDismissDialog
          busy={claim.busy}
          describe={describe}
          detail={detail}
          failure={failure}
          messages={appealCopy}
          notice={notice}
          onCancel={() => {
            setDialog(null)
            setFailure(null)
          }}
          onConfirm={(text) => {
            void dismiss(text)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * 지금 할 수 있는 처리 — **버튼이거나, 왜 아닌지를 말하는 문단이거나.**
 *
 * 문단은 `role="note"` 이지 `alert` 이 아니다. 잘못된 일이 일어난 것이 아니라 이 화면의
 * 성질을 설명하는 것이기 때문이다. 서버가 거절한 뒤의 문단만 `alert` 이다 — 그것은
 * 방금 한 행동의 답이다.
 */
function ClaimActions({
  claim,
  messages,
  mayHandle,
  demoScoped,
  permissionReason,
  refused,
  refusedSentence,
  onForce,
  onDismiss,
}: {
  readonly claim: Claim
  readonly messages: AdminClaimMessages
  readonly mayHandle: boolean
  readonly demoScoped: boolean
  readonly permissionReason: string | undefined
  readonly refused: ApiFailure | null
  readonly refusedSentence: string | undefined
  readonly onForce: () => void
  readonly onDismiss: () => void
}) {
  const { detail } = messages
  const block = interventionBlockOf(claim.status)
  const appealPending = claim.appeal !== null && claim.appeal.reviewedAt === null

  if (!mayHandle) {
    return (
      <p
        className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-sm"
        role="note"
      >
        {permissionReason === undefined
          ? detail.blocked.permission
          : `${permissionReason} ${detail.blocked.permission}`}
      </p>
    )
  }

  // 서버가 이 건에 대해 답했다. 버튼을 다시 내밀면 같은 거절을 한 번 더 받게 된다.
  if (refused !== null) {
    return (
      <div
        className="border-danger bg-danger-surface text-fg flex flex-col gap-1 rounded-md border p-3 text-sm"
        role="alert"
      >
        <p className="font-medium">{detail.blocked.refusedTitle}</p>
        <p>{refusedSentence}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {block === null ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onForce} type="button" variant="danger">
            {detail.actions.force}
          </Button>
          {appealPending ? (
            <Button onClick={onDismiss} type="button" variant="outline">
              {detail.actions.dismissAppeal}
            </Button>
          ) : null}
        </div>
      ) : (
        <div
          className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3 text-sm"
          role="note"
        >
          <p className="text-fg font-medium">{detail.blocked.title}</p>
          <p className="text-fg-muted">{detail.blocked.state[block]}</p>
        </div>
      )}

      {demoScoped ? (
        <p className="text-fg-subtle text-xs" role="note">
          {messages.scope.demoNotice}
        </p>
      ) : null}
    </div>
  )
}

/** 이의 — 걸려 있으면 그 내용을, 끝났으면 결과와 사유를. */
function AppealPanel({
  appeal,
  messages,
}: {
  readonly appeal: Claim['appeal']
  readonly messages: AdminClaimMessages
}) {
  const { appeal: copy, detail } = messages

  if (appeal === null) {
    return (
      <section aria-label={detail.sections.appeal} className="flex flex-col gap-2">
        <h2 className="text-fg text-lg font-medium">{detail.sections.appeal}</h2>
        <p className="text-fg-muted text-sm">{copy.none}</p>
      </section>
    )
  }

  const pending = appeal.reviewedAt === null

  return (
    <section aria-label={detail.sections.appeal} className="flex flex-col gap-2">
      <h2 className="text-fg text-lg font-medium">{detail.sections.appeal}</h2>
      <p className="text-fg font-medium">{pending ? copy.pendingTitle : copy.reviewedTitle}</p>
      {pending ? <p className="text-fg-muted text-sm">{copy.pendingBody}</p> : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">{copy.filedAt}</dt>
        <dd>{claimDateTime(appeal.filedAt)}</dd>
        <dt className="text-fg-muted">{copy.reason}</dt>
        <dd className="whitespace-pre-wrap">{appeal.reason}</dd>
        {appeal.reviewedAt === null ? null : (
          <>
            <dt className="text-fg-muted">{copy.reviewedAt}</dt>
            <dd>{claimDateTime(appeal.reviewedAt)}</dd>
          </>
        )}
        {appeal.outcome === null ? null : (
          <>
            <dt className="text-fg-muted">{copy.outcome}</dt>
            <dd>{copy.outcomes[appeal.outcome]}</dd>
            <dt className="text-fg-muted">{copy.reviewNote}</dt>
            {/*
              인용에는 사유가 없다. 빈칸으로 두면 「적지 않았다」로 읽히므로, 근거가
              **어디에 있는지**를 대신 적는다 — 개입 클레임의 이력이다.
            */}
            <dd>{appeal.reviewNote ?? copy.noNote}</dd>
          </>
        )}
      </dl>
    </section>
  )
}

/** 개입의 두 방향. 어느 쪽도 없으면 그 사실을 적는다. */
function InterventionPanel({
  claim,
  messages,
}: {
  readonly claim: Claim
  readonly messages: AdminClaimMessages
}) {
  const { detail } = messages
  const copy = detail.intervention
  const none = claim.overturnsClaimId === null && claim.overturnedByClaimIds.length === 0

  return (
    <section aria-label={detail.sections.intervention} className="flex flex-col gap-2">
      <h2 className="text-fg text-lg font-medium">{detail.sections.intervention}</h2>

      {none ? <p className="text-fg-muted text-sm">{copy.none}</p> : null}

      {claim.overturnsClaimId === null ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-fg text-sm font-medium">{copy.overturnsTitle}</p>
          <p className="text-fg-muted text-sm">{copy.overturnsBody}</p>
          <NextLink className={linkClassName()} href={`/claims/${claim.overturnsClaimId}`}>
            {copy.openOriginal}
          </NextLink>
        </div>
      )}

      {claim.overturnedByClaimIds.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-fg text-sm font-medium">{copy.overturnedTitle}</p>
          <p className="text-fg-muted text-sm">{copy.overturnedBody}</p>
          <ul className="flex flex-col gap-1">
            {claim.overturnedByClaimIds.map((id, index) => (
              <li key={id}>
                <NextLink className={linkClassName()} href={`/claims/${id}`}>
                  {copy.openIntervention.replace('{index}', String(index + 1))}
                </NextLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
