import { z } from 'zod'

/**
 * 배송의 계약 (TASK-0061).
 *
 * **운송사에 연동하지 않는다** (CLAUDE.md 5장). 도메인과 상태 전이는 실제와 같게
 * 두되 운송·추적은 가상으로 만든다 — 그래서 이 파일이 정하는 것은 「진짜 택배가
 * 무엇을 주는가」가 아니라 **「우리가 무엇을 지어내 보이고, 그것이 진짜와 어떻게
 * 구분되는가」**다.
 *
 * 구매자와 판매자가 **같은 모양**을 본다. 둘의 차이는 필드가 아니라 **누구의 배송을
 * 읽을 수 있는가**이고, 그 판정은 서버가 한다(`assertResourceAccess`). 화면마다 다른
 * 모양을 주면 「판매자 화면에는 있는데 구매자 화면에는 없는 값」이 생기고, 그것을
 * 메우는 두 번째 조회가 반드시 따라온다.
 */

/** 운송장 번호의 접두어. 여기 있는 것이 「진짜가 아니다」를 말하는 유일한 표시다. */
export const TRACKING_NUMBER_PREFIX = 'DEMO'

/**
 * 가상 운송사 넷. **실제 상표가 아니다** (CLAUDE.md 6장 · F7).
 *
 * 계약에 두는 이유는 발송 화면이 고를 목록이기 때문이다. 이름을 서버만 알고 있으면
 * 판매자 콘솔은 코드를 고를 방법이 없어 결국 목록을 한 벌 더 적게 된다.
 *
 * 코드가 두 글자인 것은 운송장 번호 가운데 칸에 그대로 들어가기 때문이다 —
 * `DEMO-GA-000000000001` 을 보면 어느 운송사인지 사람이 읽을 수 있다.
 */
export const demoCarrierCodes = ['GA', 'HD', 'SB', 'NR'] as const

export type DemoCarrierCode = (typeof demoCarrierCodes)[number]

export const demoCarrierCodeSchema = z.enum(demoCarrierCodes)

/**
 * 코드 → 이름. **레코드라 코드를 하나 늘리면 이름이 없는 채로 지나갈 수 없다.**
 *
 * 배송 행에는 이름을 **스냅샷으로** 복사한다(`carrierName`). 이 표가 나중에 바뀌어도
 * 과거 배송 이력이 「그때 어디로 보냈나」에 계속 답해야 하기 때문이다 —
 * `OrderItem.productSnapshot` 과 같은 이유다 (ERD 설계 원칙 2).
 */
export const demoCarrierNames: Readonly<Record<DemoCarrierCode, string>> = {
  GA: '가온물류',
  HD: '한들택배',
  SB: '새벽로지스',
  NR: '나루배송',
}

/**
 * 배송이 지나는 상태.
 *
 * **주문 상태(`SellerOrderStatus`)와 다른 축이다.** 주문은 `SHIPPED` 하나로 「보냈다」를
 * 말하고, 이쪽은 그 안에서 물건이 어디쯤 왔는지를 말한다. 하나로 합치면 주문 상태에
 * 배송 중간값이 섞이고, 정산·클레임이 읽는 상태가 택배 진행에 따라 흔들린다.
 *
 * `READY` 는 「아직 아무 일도 없다」가 아니라 **「집화됐고 아직 간선에 오르지 않았다」**다.
 * 운송장은 발송 처리와 함께 나오고 그 순간 첫 이벤트(`PICKED_UP`)가 남으므로, 이보다
 * 앞선 상태는 존재할 수 없다.
 */
export const shipmentStatuses = ['READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const

export type ShipmentStatus = (typeof shipmentStatuses)[number]

export const shipmentStatusSchema = z.enum(shipmentStatuses)

/**
 * 추적 이벤트의 종류 — 집화 · 간선상차 · 배송출발 · 배송완료.
 *
 * 상태 이름과 값이 겹치는 것 셋이 있는데도 열거형을 따로 두는 이유는
 * `PaymentEventKind` 와 같다: **이벤트는 사건이고 상태는 결과다.** 지금은 사건 하나가
 * 상태 하나를 정하지만(`shipmentStatusAfter`), 상태를 바꾸지 않는 사건 — 배송 실패,
 * 재시도 — 이 생기면 그때 갈라지는 것은 이 목록이지 상태 목록이 아니다.
 */
export const trackingEventKinds = [
  /** 집화. 운송사가 물건을 받았다. 발송 처리가 남기는 첫 줄이다. */
  'PICKED_UP',
  /** 간선상차. 터미널 사이를 이동한다. */
  'IN_TRANSIT',
  /** 배송출발. 받는 사람 쪽 영업소를 떠났다. */
  'OUT_FOR_DELIVERY',
  /** 배송완료. */
  'DELIVERED',
] as const

export type TrackingEventKind = (typeof trackingEventKinds)[number]

export const trackingEventKindSchema = z.enum(trackingEventKinds)

/**
 * 추적 이력 한 줄.
 *
 * `location` 과 `description` 이 **서버가 만든 문자열**인 것은 이것이 UI 문구가 아니라
 * **기록**이기 때문이다. 실제 택배에서도 이 두 칸은 운송사가 적어 보내는 값이고,
 * 화면은 그것을 그린다 — 앱의 메시지 파일로 옮기면 지난 이벤트의 문장이 앱을 고칠
 * 때마다 바뀐다.
 */
export const trackingEventSchema = z.object({
  id: z.uuid(),
  kind: trackingEventKindSchema,
  /** 가상 지명이다. 실제 터미널 이름을 쓰지 않는다. */
  location: z.string(),
  occurredAt: z.iso.datetime(),
  description: z.string(),
})

export type TrackingEvent = z.infer<typeof trackingEventSchema>

/**
 * 배송 하나. `SellerOrder` 당 **한 건**이다 (TASK-0061 2장).
 *
 * 분할 배송은 이번 범위 밖이다 — 판매자 몫 안에서 다시 나뉘면 「이 주문은 배송
 * 중인가」의 답이 여러 개가 되고, 상태 판단이 한 단계 더 복잡해진다.
 */
export const shipmentSchema = z.object({
  id: z.uuid(),
  sellerOrderId: z.uuid(),
  carrierCode: demoCarrierCodeSchema,
  /** 발급 시점의 운송사 이름 스냅샷. 표가 바뀌어도 과거 배송은 그대로다. */
  carrierName: z.string(),
  /**
   * 운송장 번호. `DEMO-{운송사코드}-{12자리}`.
   *
   * **형식을 계약이 단언한다.** 이 접두어가 「진짜 운송장이 아니다」를 말하는 유일한
   * 표시라, 서버가 언젠가 실제 번호처럼 생긴 값을 내보내면 계약 게이트(C3)에서
   * 빨개져야 한다 — 화면의 「가상 배송 정보」 안내는 스크린샷 한 장이 지나가는 순간
   * 사라지지만 번호는 남는다.
   */
  trackingNumber: z.string().regex(/^DEMO-[A-Z]{2}-[0-9]{12}$/u),
  status: shipmentStatusSchema,
  /** 발송된 시각. 배송 행은 발송으로만 생기므로 언제나 값이 있다. */
  shippedAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  /** **시간순**이다. 같은 밀리초는 서버가 안정적인 순서로 깬다. */
  events: z.array(trackingEventSchema),
})

export type Shipment = z.infer<typeof shipmentSchema>

export const shipmentResponseSchema = z.object({ shipment: shipmentSchema })

export type ShipmentResponse = z.infer<typeof shipmentResponseSchema>

/**
 * 발송 처리 요청 (`POST /seller-orders/:id/shipment`).
 *
 * 운송사는 **선택**이다. 판매자가 고르면 그것을 쓰고, 말이 없으면 서버가 고른다 —
 * 발송 화면이 아직 없는 동안에도 흐름이 끊기지 않아야 하고, 어차피 가상 운송사라
 * 「어디로 맡겼는가」가 이 데모에서 뜻하는 바는 표시뿐이다.
 */
export const shipSellerOrderRequestSchema = z.object({
  carrierCode: demoCarrierCodeSchema.optional(),
})

export type ShipSellerOrderRequest = z.infer<typeof shipSellerOrderRequestSchema>
