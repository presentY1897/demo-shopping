import { Injectable } from '@nestjs/common'

import { WEBHOOK_LAST_RECEIVED_KEY } from '../payment/payment-webhook.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * 마지막으로 결제 웹훅을 받은 시각, `/health` 용 (TASK-0056 2장).
 *
 * **행을 읽지, 서비스를 읽지 않는다.** 수신 서비스가 자기 도착을 `AppMeta` 에
 * 적으므로 그 답은 재시작을 넘겨 살아남고 어느 인스턴스에 물어도 같으며,
 * `HealthModule` 이 `PaymentModule` 을 import 하지 않아도 된다 — API 가 살아
 * 있는지 말하는 엔드포인트를 결제를 쥐는 모듈에 묶지 않는 것이 요점이다.
 * `DemoCleanupReporter` 가 이 파일의 원본이고, 거기 적힌 이유가 그대로 적용된다.
 *
 * **일부러 `HealthIndicator` 가 아니다.** 지표는 전체 판정에 실리는 상태를 답하고,
 * 웹훅이 한 건도 안 온 것은 고장이 아니다 — 결제사 키가 없는 배포, 웹훅 URL 을
 * 아직 등록하지 않은 배포, 아무도 결제하지 않은 한 시간이 전부 그 상태다. 그것을
 * `degraded` 로 올리면 헬스체크가 늘 빨갛고, 늘 빨간 헬스체크는 아무도 안 본다.
 *
 * 웹훅이 **끊긴** 것을 판정하는 것은 대사 배치 쪽 지표다. 웹훅을 놓쳐도 상태를
 * 맞추는 것이 그쪽의 일이라, 「웹훅이 안 온다」가 실제로 아픈 순간은 대사까지 함께
 * 멈춘 순간이다. 여기서 같은 판정을 한 번 더 내리면 두 곳이 조용히 어긋난다.
 */
@Injectable()
export class PaymentWebhookReporter {
  constructor(private readonly prisma: PrismaService) {}

  async lastReceivedAt(): Promise<string | null> {
    try {
      const row = await this.prisma.appMeta.findUnique({
        where: { key: WEBHOOK_LAST_RECEIVED_KEY },
        select: { value: true },
      })

      if (row === null) return null

      const parsed = new Date(row.value)

      // 손으로 고친 행이 헬스체크를 데리고 넘어지면 안 된다.
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
    } catch {
      /*
       * **데이터베이스가 죽은 것은 이 필드가 전할 소식이 아니다.**
       *
       * `demo-cleanup.reporter.ts` 가 남긴 교훈이다 — 곁다리 필드를 못 읽었다고
       * `/health` 가 500 을 내면 그것은 「프로세스가 없다」로 읽히고, 그렇게 믿은
       * 로드밸런서는 마지막 살아 있는 인스턴스로 가는 트래픽을 끊는다. 데이터베이스
       * 장애를 말하는 것은 `database` 지표이고, 그쪽은 던지지 않고 `down` 을 답한다.
       */
      return null
    }
  }
}
