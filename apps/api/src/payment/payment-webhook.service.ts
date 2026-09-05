import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { RecoveryOutcome } from './payment.service.js'
import { PaymentService } from './payment.service.js'
import type { WebhookReference } from './payment-webhook.js'
import {
  hasValidSignature,
  parseWebhookBody,
  webhookReferenceOf,
  WEBHOOK_LAST_RECEIVED_KEY,
} from './payment-webhook.js'

/** 웹훅 한 건이 무엇으로 끝났나. 로그와 검사가 읽는다. */
export type WebhookOutcome =
  /** 우리 결제를 찾아 저쪽에 다시 물었다. 그 답이 무엇이었는지는 결제 쪽 결과다. */
  | { readonly handled: true; readonly paymentId: string; readonly recovery: RecoveryOutcome }
  /** 우리 결제가 아니었다. 받았고, 아무것도 바꾸지 않았다. */
  | { readonly handled: false }

/**
 * 토스 웹훅 수신 (TASK-0056 F1 · F2 · F3 · F4 · F5).
 *
 * **이 서비스는 상태를 정하지 않는다.** 하는 일은 셋뿐이다 — 보낸 쪽이 맞는지 보고
 * (서명), 도착한 사실을 남기고(원문), 결제 쪽 문을 두드린다
 * (`PaymentService.resolveUnresolved`). 상태를 정하는 것은 그 문 너머에서 **저쪽에
 * 다시 물어본 답**이고, 웹훅 본문은 「지금 확인해 보라」는 신호일 뿐이다.
 *
 * 그 선택 하나가 이 TASK 의 요구사항 대부분을 접는다 — 이유는
 * `payment-webhook.ts` 의 표에 있다. 여기서는 그 결과만 적는다: **같은 웹훅이 세
 * 번 와도 세 번 다 「지금 저쪽 상태」를 읽어 같은 결론에 닿고**(F2), 오래된 이벤트가
 * 나중에 도착해도 우리가 읽는 것은 그 이벤트가 아니라 현재다(F3).
 *
 * **오류를 아끼는 라우트다.** 2xx 가 아니면 PG 는 재전송한다 — 그것이 웹훅의
 * 계약이다. 그래서 「우리 결제가 아니다」는 200 이고(재전송해 봐야 영원히 남의
 * 결제다), 401·400 은 **재전송이 도움이 되지 않는데도** 내는 두 자리다: 앞은 아예
 * 다른 상대이고, 뒤는 우리가 읽을 수 없는 본문이라 조용히 삼키면 양쪽 이력이
 * 「성공」으로 남아 아무도 모르게 된다.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly log = new Logger(PaymentWebhookService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentService,
  ) {}

  /**
   * 웹훅 한 건.
   *
   * 순서에 뜻이 있다. 서명 → 도착 기록 → 원문 보존 → 다시 묻기.
   *
   * **도착 기록이 처리보다 앞이다.** 뒤에 두면 처리에서 터진 날 「웹훅이 안 온다」와
   * 「와서 터진다」를 헬스체크로 구분할 수 없다 — 그 둘은 사람이 갈 곳이 다르다
   * (앞은 PG 설정, 뒤는 우리 로그).
   */
  async receive(rawBody: Buffer, signature: string | undefined): Promise<WebhookOutcome> {
    if (!hasValidSignature(this.config.tossWebhookSecret, rawBody, signature)) {
      // **왜 401 인가.** 시크릿이 설정되지 않은 배포에서도 여기로 온다. 검증할 수
      // 없는 요청을 통과시키면 이 라우트는 아무나 결제 상태를 흔들 수 있는 문이
      // 되고, 그 문은 인증 가드 밖이라 뒤에 아무 방어선도 없다. 「키가 없으면
      // 검증을 건너뛴다」는 개발 편의가 그대로 배포되는 종류의 편의다.
      //
      // 도메인 코드를 붙이지 않는다. 이 응답을 읽는 것은 우리 화면이 아니라 PG 의
      // 재전송 로직이고, 그쪽이 보는 것은 상태 코드뿐이다.
      throw new UnauthorizedException('서명을 확인할 수 없어요.')
    }

    const now = this.clock.now()

    await this.recordArrival(now)

    const payload = parseWebhookBody(rawBody)

    if (payload === null) {
      this.log.warn('웹훅 본문을 JSON 으로 읽지 못했습니다.')

      throw new BadRequestException('본문을 읽을 수 없어요.')
    }

    const reference = webhookReferenceOf(payload)
    const paymentId = await this.locate(reference)

    if (paymentId === null) {
      // **남의 것이거나 오래된 테스트다.** 404 를 주면 PG 가 재전송하고, 그
      // 재전송은 영원히 같은 답을 받는다. 로그 한 줄로 남기고 200 을 준다 —
      // `PaymentEvent` 는 결제에 딸린 표라 결제가 없으면 앉힐 자리가 없다.
      this.log.warn('우리 결제를 가리키지 않는 웹훅을 받았습니다.')

      return { handled: false }
    }

    await this.preserve(paymentId, rawBody, signature, now)

    // **여기서 상태가 정해진다 — 본문이 아니라 저쪽의 답으로.** 이 결제가 이미
    // 풀렸으면 `noop` 이 돌아오고, 그것이 F2 가 말하는 「두 번째는 상태를 건드리지
    // 않는다」의 실제 모양이다.
    const recovery = await this.payments.resolveUnresolved(paymentId)

    // **결과가 로그로도 남는다.** 이 라우트는 언제나 200 이라 응답만 봐서는 「무슨
    // 일이 있었나」를 알 수 없고, `noop` 이 계속 나오는 것은 재전송이 잦다는 뜻이라
    // 그 자체로 읽을 값이 있다. 결제당 사건은 `PaymentEvent` 가 따로 남긴다.
    this.log.debug(`웹훅으로 결제 ${paymentId} 를 확인했습니다: ${recovery}`)

    return { handled: true, paymentId, recovery }
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이 웹훅이 가리키는 우리 결제 id.
   *
   * 두 열쇠를 순서대로 본다. `orderId`(= 우리 `Payment.id`)가 먼저인 이유는 그것이
   * **승인 전에도 있는** 유일한 값이기 때문이다 — 결제키는 저쪽의 답에 실려 오는데,
   * 그 답을 못 받은 결제가 정확히 이 TASK 가 구하려는 `UNRESOLVED` 다.
   */
  private async locate(reference: WebhookReference): Promise<string | null> {
    if (reference.paymentId !== null) {
      const byId = await this.prisma.payment.findUnique({
        where: { id: reference.paymentId },
        select: { id: true },
      })

      if (byId !== null) return byId.id
    }

    if (reference.paymentKey === null) return null

    const byKey = await this.prisma.payment.findUnique({
      where: { paymentKey: reference.paymentKey },
      select: { id: true },
    })

    return byKey?.id ?? null
  }

  /**
   * 도착한 웹훅을 **원문 그대로** 남긴다 (F5).
   *
   * `kind` 는 `WEBHOOK`, 상태 전후는 **둘 다 `null`** 이다. 이 사건 자체는 상태를
   * 옮기지 않기 때문이고 — 옮기는 것은 뒤따르는 `resolveUnresolved` 이며 그쪽이
   * 자기 사건을 따로 남긴다 — `PaymentEvent_transition_check` 가 그 짝을 강제한다.
   *
   * **파싱한 JSON 이 아니라 문자열 그대로 넣는다.** 다시 직렬화하면 키 순서와
   * 공백이 달라져 **서명을 다시 검증할 수 없게 된다.** 분쟁에서 이 행이 답해야 하는
   * 질문이 「그때 뭐라고 왔었나」와 「그것이 진짜 저쪽에서 온 것인가」 둘이므로,
   * 서명도 함께 남는다. 구조로 읽고 싶으면 `payload->>'raw'` 를 `::jsonb` 로
   * 캐스팅하면 되고, 파싱본을 한 벌 더 두면 그 둘이 언젠가 어긋난다.
   *
   * **상태를 바꿨는지와 무관하게 남는다.** 그래서 같은 웹훅이 세 번 오면 세 줄이
   * 남는다 — 「몇 번 왔는가」는 중복 조사에서 가장 먼저 묻는 질문이고, 두 번째
   * 도착을 지운 기록으로는 답할 수 없다.
   */
  private async preserve(
    paymentId: string,
    rawBody: Buffer,
    signature: string | undefined,
    now: Date,
  ): Promise<void> {
    await this.prisma.paymentEvent.create({
      data: {
        paymentId,
        kind: 'WEBHOOK',
        fromStatus: null,
        toStatus: null,
        payload: { raw: rawBody.toString('utf8'), signature: signature ?? null },
        createdAt: now,
      },
    })
  }

  /**
   * 마지막으로 웹훅을 받은 시각. 헬스체크가 읽는다 (2장 범위).
   *
   * `reservation-sweeper.service.ts` 의 `record` 와 같은 모양이다 — `AppMeta` 에
   * 적어 두면 재시작을 넘겨 살아남고 어느 인스턴스에 물어도 같은 답이 나온다.
   */
  private async recordArrival(now: Date): Promise<void> {
    const value = now.toISOString()

    await this.prisma.appMeta.upsert({
      where: { key: WEBHOOK_LAST_RECEIVED_KEY },
      create: { key: WEBHOOK_LAST_RECEIVED_KEY, value },
      update: { value },
    })
  }
}
