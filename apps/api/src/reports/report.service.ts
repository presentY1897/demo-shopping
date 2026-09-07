import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma, ReportTargetType } from '@prisma/client'
import type {
  CreateReportRequest,
  HandleReportRequest,
  Report,
  ReportListQueryParams,
  ReportListResponse,
} from '@shopping/shared'
import { REPORT_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { NotificationService } from '../notifications/notification.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { REPORT_EFFECT, isHandled, reachesAutoHide, removable } from './report-rules.js'

/** 신고된 대상 하나 — 관리자가 판단하는 데 필요한 만큼. */
interface Target {
  readonly ownerId: string | null
  readonly hidden: boolean
  readonly excerpt: string | null
}

/**
 * 신고 (TASK-0091).
 *
 * ## 대상마다 표가 다르고, 그 차이를 여기가 흡수한다
 *
 * 리뷰 · 문의 · 답변 · 상품은 각자 「가려짐」을 다르게 적는다 — 리뷰는 상태 열거형이
 * 있고, 문의와 답변은 시각 한 칸이며, 상품은 판매 상태를 쓴다. 그 넷을 **한 곳에서만**
 * 아는 것이 이 서비스의 일이고, 그래서 처리 코드에 `switch` 가 셋이 아니라 하나다.
 *
 * ## 자동 임시 숨김은 정확히 임계치에서만
 *
 * 그 뒤로도 가리면 관리자가 반려해 복구한 대상이 다음 신고에 곧바로 다시 가려지고,
 * **반려가 아무 뜻도 없어진다** (`report-rules.ts`).
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly notifications: NotificationService,
  ) {}

  /** 신고한다 (F1 · F2 · F3). */
  async create(userId: string, request: CreateReportRequest): Promise<Report> {
    const target = await this.target(request.targetType, request.targetId)

    if (target === null) throw new NotFoundException('신고할 대상을 찾을 수 없어요.')

    // **자기 글은 신고할 수 없다.** 지우거나 고치는 문이 따로 있고, 신고로 자기 글을
    // 가리는 길을 열면 그것은 신고 통계를 흐리는 우회로가 된다.
    if (target.ownerId === userId) {
      throw new ConflictException(
        domainFailure('REPORT_OWN_CONTENT', '자기 글은 신고할 수 없어요.'),
      )
    }

    const now = this.clock.now()
    const created = await this.prisma.$transaction(async (tx) => {
      const report = await tx.report
        .create({
          data: {
            targetType: request.targetType,
            targetId: request.targetId,
            reporterId: userId,
            reason: request.reason,
            detail: request.detail ?? null,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        })
        .catch((error: unknown) => {
          // 같은 사람이 같은 대상을 두 번 신고할 수 없다 — 유니크가 막는다 (F2).
          if (isUniqueViolation(error)) {
            throw new ConflictException(
              domainFailure('REPORT_ALREADY_FILED', '이미 신고한 대상이에요.'),
            )
          }

          throw error
        })
      const pending = await tx.report.count({
        where: {
          targetType: request.targetType,
          targetId: request.targetId,
          status: 'PENDING',
        },
      })

      // 정확히 임계치에서만. 그 뒤로도 가리면 반려가 아무 뜻도 없어진다 (F3).
      if (reachesAutoHide(pending)) {
        await this.setHidden(tx, request.targetType, request.targetId, true, now)
      }

      return report.id
    })

    return this.load(created)
  }

  /** 관리자 목록. 처리 대기부터. */
  async list(params: ReportListQueryParams): Promise<ReportListResponse> {
    const limit = params.limit ?? REPORT_LIST_DEFAULT_LIMIT
    const where: Prisma.ReportWhereInput = {
      ...(params.status === undefined ? {} : { status: { in: [...params.status] } }),
      ...(params.targetType === undefined ? {} : { targetType: params.targetType }),
      ...(params.cursor === undefined ? {} : { id: { lt: params.cursor } }),
    }
    const [rows, pendingCount] = await Promise.all([
      this.prisma.report.findMany({
        where,
        orderBy: { id: 'desc' },
        take: limit + 1,
        select: REPORT_SELECT,
      }),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
    ])
    const page = rows.slice(0, limit)

    return {
      reports: await Promise.all(page.map(async (row) => this.answer(row))),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      pendingCount,
    }
  }

  /**
   * 처리한다 (F4 · F5 · F6 · F7).
   *
   * **데모 관리자는 실계정의 글을 지우거나 가릴 수 없다** (D-058). 그 거절은 이
   * 서비스의 조건문이 아니라 대상의 **주인이 누구인가**가 만든다 — 데모 관리자의
   * `content.moderate` 는 `demo` 로 좁혀져 있고, 실계정이 쓴 글은 그 스코프가 닿지
   * 않는다.
   */
  async handle(
    principal: RequestPrincipal,
    id: string,
    request: HandleReportRequest,
  ): Promise<Report> {
    const report = await this.prisma.report.findUnique({
      where: { id },
      select: { id: true, status: true, targetType: true, targetId: true, reporterId: true },
    })

    if (report === null) throw new NotFoundException('신고를 찾을 수 없어요.')

    if (isHandled(report.status)) {
      throw new ConflictException(domainFailure('REPORT_ALREADY_HANDLED', '이미 처리된 신고예요.'))
    }

    await this.assertMayModerate(principal, report.targetType, report.targetId)

    const effect = REPORT_EFFECT[request.outcome]

    if (effect === 'remove' && !removable(report.targetType)) {
      throw new ConflictException(
        domainFailure('REPORT_NOT_REMOVABLE', '상품은 지울 수 없어요. 숨김으로 처리해 주세요.'),
      )
    }

    const now = this.clock.now()

    await this.prisma.$transaction(async (tx) => {
      if (effect === 'remove') await this.remove(tx, report.targetType, report.targetId)
      else await this.setHidden(tx, report.targetType, report.targetId, effect === 'hide', now)

      // **같은 대상의 다른 대기 신고도 함께 닫는다.** 한 대상에 대한 판단은 하나이고,
      // 남겨 두면 관리자가 이미 결론 난 것을 몇 번씩 다시 읽는다.
      await tx.report.updateMany({
        where: { targetType: report.targetType, targetId: report.targetId, status: 'PENDING' },
        data: {
          status: request.outcome,
          handledById: principal.userId,
          handledAt: now,
          handledNote: request.note,
          updatedAt: now,
        },
      })
    })

    void this.notifications.send({
      userId: report.reporterId,
      type: 'REPORT_HANDLED',
      title: '신고가 처리됐어요',
      body: request.note,
    })

    return this.load(id)
  }

  private async load(id: string): Promise<Report> {
    const row = await this.prisma.report.findUniqueOrThrow({ where: { id }, select: REPORT_SELECT })

    return this.answer(row)
  }

  private async answer(row: ReportRow): Promise<Report> {
    const [target, targetReportCount] = await Promise.all([
      this.target(row.targetType, row.targetId),
      this.prisma.report.count({ where: { targetType: row.targetType, targetId: row.targetId } }),
    ])

    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      detail: row.detail,
      status: row.status,
      targetReportCount,
      targetHidden: target?.hidden ?? false,
      targetExcerpt: target?.excerpt ?? null,
      handledNote: row.handledNote,
      handledAt: row.handledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  }

  /**
   * 대상 하나를 **같은 모양으로** 읽는다.
   *
   * 표가 넷이라 조회도 넷인데, 부르는 쪽이 넷을 아는 것이 아니라 여기가 안다 — 이
   * 함수가 없으면 「가려졌는가」를 묻는 코드가 화면 수만큼 생긴다.
   */
  private async target(type: ReportTargetType, id: string): Promise<Target | null> {
    if (type === 'REVIEW') {
      const row = await this.prisma.review.findUnique({
        where: { id },
        select: { userId: true, status: true, content: true },
      })

      return row === null
        ? null
        : { ownerId: row.userId, hidden: row.status !== 'PUBLISHED', excerpt: row.content }
    }

    if (type === 'QUESTION') {
      const row = await this.prisma.productQuestion.findUnique({
        where: { id },
        select: { userId: true, hiddenAt: true, content: true },
      })

      return row === null
        ? null
        : { ownerId: row.userId, hidden: row.hiddenAt !== null, excerpt: row.content }
    }

    if (type === 'ANSWER') {
      const row = await this.prisma.productAnswer.findUnique({
        where: { questionId: id },
        select: { authorId: true, hiddenAt: true, content: true },
      })

      return row === null
        ? null
        : { ownerId: row.authorId, hidden: row.hiddenAt !== null, excerpt: row.content }
    }

    const row = await this.prisma.product.findUnique({
      where: { id },
      select: { name: true, status: true, seller: { select: { userId: true } } },
    })

    return row === null
      ? null
      : { ownerId: row.seller.userId, hidden: row.status === 'SUSPENDED', excerpt: row.name }
  }

  /** 가리거나 드러낸다. 넷의 차이가 여기 한 곳에만 있다. */
  private async setHidden(
    tx: Prisma.TransactionClient,
    type: ReportTargetType,
    id: string,
    hidden: boolean,
    now: Date,
  ): Promise<void> {
    if (type === 'REVIEW') {
      // 쓴 사람이 지운 리뷰는 되살리지 않는다 — 신고 처리가 남의 삭제를 무르는 일이
      // 되면 안 된다.
      await tx.review.updateMany({
        where: { id, status: { in: hidden ? ['PUBLISHED'] : ['HIDDEN'] } },
        data: { status: hidden ? 'HIDDEN' : 'PUBLISHED', updatedAt: now },
      })

      return
    }

    if (type === 'QUESTION') {
      await tx.productQuestion.updateMany({
        where: { id },
        data: { hiddenAt: hidden ? now : null, updatedAt: now },
      })

      return
    }

    if (type === 'ANSWER') {
      await tx.productAnswer.updateMany({
        where: { questionId: id },
        data: { hiddenAt: hidden ? now : null, updatedAt: now },
      })

      return
    }

    // 상품은 **판매를 멈추는 것**이 가리는 것이다. 되돌릴 때 `ACTIVE` 로 두는 것은
    // 신고 전 상태가 그것이었기 때문이고(`SUSPENDED` 가 아니면 애초에 안 가려졌다),
    // 판매자가 그 사이 내린 상품은 조건이 걸러 낸다.
    await tx.product.updateMany({
      where: { id, status: hidden ? 'ACTIVE' : 'SUSPENDED' },
      data: { status: hidden ? 'SUSPENDED' : 'ACTIVE', updatedAt: now },
    })
  }

  /** 지운다. 상품은 여기 오지 않는다 — `removable` 이 앞에서 막는다. */
  private async remove(
    tx: Prisma.TransactionClient,
    type: ReportTargetType,
    id: string,
  ): Promise<void> {
    const now = this.clock.now()

    if (type === 'REVIEW') {
      await tx.review.updateMany({ where: { id }, data: { status: 'DELETED', updatedAt: now } })

      return
    }

    if (type === 'QUESTION') {
      await tx.productQuestion.delete({ where: { id } })

      return
    }

    await tx.productAnswer.delete({ where: { questionId: id } })
  }

  /**
   * 이 사람이 이 대상을 처리해도 되는가 (F7).
   *
   * **데모 관리자는 실계정의 글을 건드릴 수 없다** (D-058). 거절은 조건문이 아니라
   * 스코프가 만든다 — 그쪽의 `content.moderate` 는 `demo` 로 좁혀져 있고, 대상의
   * 주인이 실계정이면 그 스코프가 닿지 않는다.
   */
  private async assertMayModerate(
    principal: RequestPrincipal,
    type: ReportTargetType,
    id: string,
  ): Promise<void> {
    const target = await this.target(type, id)

    if (target?.ownerId == null) throw new NotFoundException('신고할 대상을 찾을 수 없어요.')

    const owner = await this.prisma.user.findUnique({
      where: { id: target.ownerId },
      select: accountOwnershipSelect,
    })

    if (owner === null) throw new NotFoundException('신고할 대상을 찾을 수 없어요.')

    assertResourceAccess(principal, 'content.moderate', accountOwnership(owner))
  }
}

const REPORT_SELECT = {
  id: true,
  targetType: true,
  targetId: true,
  reason: true,
  detail: true,
  status: true,
  handledNote: true,
  handledAt: true,
  createdAt: true,
} satisfies Prisma.ReportSelect

type ReportRow = Prisma.ReportGetPayload<{ select: typeof REPORT_SELECT }>

/** 유니크 위반인가. 「이미 신고했다」를 조회 없이 알아내는 유일한 방법이다. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}
