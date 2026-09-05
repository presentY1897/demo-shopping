import type { DemoCarrierCode, ShipmentStatus, TrackingEventKind } from '@shopping/shared'
import {
  demoCarrierCodes,
  demoCarrierNames,
  shipmentStatuses,
  TRACKING_NUMBER_PREFIX,
} from '@shopping/shared'

/**
 * 가상 운송장의 순수 판단 (TASK-0061 4장).
 *
 * 서비스에서 떼어 놓은 이유는 **여기가 틀리면 이 TASK 의 존재 이유가 사라지기**
 * 때문이다. 배송을 가상으로 만드는 것은 운송사에 연동하지 않기 위해서인데, 그 대가로
 * 우리가 지켜야 하는 것이 하나 있다 — **발급한 번호가 진짜 운송장과 구분되는 것**
 * (F2 · R1). 접두어가 한 번 빠지면 화면의 「가상 배송 정보」 안내는 스크린샷 한 장이
 * 지나가는 순간 사라지고, 남는 것은 실제 조회창에 넣어 보는 사람뿐이다.
 *
 * 데이터베이스도 시계도 보지 않는다. 난수를 인자로 받는 것은 `orders/order-number.ts`
 * 와 `payment/virtual-card-rules.ts` 가 같은 이유로 그러하다 — crypto 모듈을 흉내
 * 내지 않고 형식을 재기 위해서다. I/O 가 없으므로 분기 전부가 단위 테스트에서 닿고,
 * 이 TASK 의 Q5 는 **분기 커버리지 100%** 다. 뒤집어 말하면 **닿을 수 없는 방어
 * 분기를 쓰지 않는다.**
 *
 * **충돌은 여기서 다루지 않는다.** 12자리 난수는 10^12 의 공간이라 겹칠 확률이
 * 사실상 없지만 0은 아니고, 0이 아닌 것을 애플리케이션이 보증할 방법도 없다 —
 * 마지막 방어선은 `Shipment_trackingNumber_key` 이고, 겹치면 서비스가 트랜잭션을
 * 통째로 다시 한다(`OrderService` 의 주문번호와 같은 모양). 그래서 이 파일에는
 * 「이미 쓰인 번호인가」를 묻는 함수가 없다. 그것을 물으려면 DB 를 봐야 하고, 봐서
 * 답을 얻어도 그 답은 쓰는 순간 이미 낡았다.
 */

/** 접두어와 운송사 코드 뒤의 자릿수. 한 바이트가 한 자리다. */
export const TRACKING_NUMBER_DIGITS = 12

/**
 * 발급된 번호가 만족해야 하는 형식.
 *
 * 접두어가 계약(`@shopping/shared` 의 `TRACKING_NUMBER_PREFIX`)과 여기 두 번 적혀
 * 있다. 정규식에 상수를 끼워 넣지 않는 이유는 `virtual-card-rules.ts` 와 같다 —
 * 그렇게 만든 패턴은 **자기가 검사할 값과 같은 자리에서 왔기** 때문에 아무것도
 * 검사하지 못한다. 둘이 갈라지지 않는 것은 스펙이 재고, 세 번째 사본인 DB 의
 * `Shipment_trackingNumber_format_check` 는 통합 검사가 잰다.
 */
export const TRACKING_NUMBER_PATTERN = /^DEMO-[A-Z]{2}-[0-9]{12}$/u

/**
 * 운송장 번호 한 건 (F2).
 *
 * 한 바이트가 한 자리이고 `% 10` 이다. 256 은 10의 배수가 아니라 0~5 가 6~9 보다
 * 조금 더 자주 나오는데(26/256 대 25/256), 없애지 않은 이유는 이 번호가 지켜야 하는
 * 성질이 **비밀이 아니라 충돌하지 않는 것**이기 때문이다 — 조회는 배송 id 로 하지
 * 번호로 하지 않는다. `virtual-card-rules.ts` 의 카드번호와 같은 판단이다.
 *
 * 바이트가 모자라면 짧은 번호가 나오고, 그것은 형식 검사와 DB 의 CHECK 가 함께
 * 거절한다. 부르는 쪽이 {@link TRACKING_NUMBER_DIGITS} 바이트를 넘긴다.
 */
export function trackingNumberFrom(carrierCode: DemoCarrierCode, bytes: Uint8Array): string {
  const digits = Array.from(bytes, (byte) => String(byte % 10)).join('')

  return `${TRACKING_NUMBER_PREFIX}-${carrierCode}-${digits}`
}

/**
 * 우리가 발급한 모양의 번호인가 (F2).
 *
 * 운송사 코드를 목록과 대조하지 **않는** 것이 이 함수의 결정이다. 묻는 것은 「이
 * 번호가 실제 운송장과 구분되는가」이고, 운송사가 하나 늘어난 날 예전 번호가 갑자기
 * 「우리 것이 아닌」 번호가 되면 안 된다. 아는 운송사인지는 {@link isKnownCarrierCode}
 * 가 따로 답한다.
 *
 * 이름을 「…인가」가 아니라 「…를 갖췄나」로 둔 것은 취향이 아니다 —
 * `auth/demo-containment.spec.ts` 가 **데모 계정 플래그의 컬럼 이름**을 소스 전체에서
 * 훑고(TASK-0105 F8), 그 이름으로 시작하는 술어를 여기 두면 이 파일이 그 검사의 허용
 * 목록에 올라가야 한다. 이 파일은 그 플래그와 아무 상관이 없으므로 올릴 자격이 없고,
 * 올리는 순간 그 목록이 지키던 것이 그만큼 헐거워진다.
 */
export function hasDemoTrackingFormat(value: string): boolean {
  return TRACKING_NUMBER_PATTERN.test(value)
}

/** 요청이 준 문자열이 우리가 아는 운송사인가. */
export function isKnownCarrierCode(value: string): value is DemoCarrierCode {
  return Object.hasOwn(demoCarrierNames, value)
}

/** 코드의 이름. 발급 시점에 배송 행으로 **복사된다**(스냅샷). */
export function carrierNameOf(code: DemoCarrierCode): string {
  return demoCarrierNames[code]
}

/**
 * 판매자가 운송사를 고르지 않았을 때 고를 하나.
 *
 * 난수에서 고르는 이유는 데모의 화면 때문이다 — 모든 배송이 같은 운송사면 운송사가
 * 여럿이라는 사실이 어디에도 드러나지 않는다.
 *
 * `reduce` 로 고르는 것은 `noUncheckedIndexedAccess` 아래에서 인덱싱이
 * `| undefined` 가 되고, 그것을 메우는 `??` 는 **어떤 입력도 닿지 못하는 분기**가 되기
 * 때문이다 — 100% 를 요구하는 파일에서 그것은 영원히 채워지지 않는 구멍이 된다
 * (`demo/demo-identity.ts` 가 같은 이유로 `slice().join('')` 을 쓴다). 초기값을 주지
 * 않은 `reduce` 는 원소 타입을 그대로 돌려주고, 목록은 리터럴 튜플이라 비어 있을 수
 * 없다.
 */
export function carrierFrom(bytes: Uint8Array): DemoCarrierCode {
  const total = bytes.reduce((sum, byte) => sum + byte, 0)
  const at = total % demoCarrierCodes.length

  return demoCarrierCodes.reduce((picked, code, index) => (index === at ? code : picked))
}

/**
 * 이 사건 뒤의 배송 상태.
 *
 * `switch` 가 아니라 **종류 전부를 덮는 레코드**인 이유는 `@shopping/shared` 에 사건을
 * 하나 더 넣고 여기를 안 고치면 **컴파일이 깨져야** 하기 때문이다. 안 그러면 새
 * 사건은 상태를 옮기지 않은 채 이력에만 쌓이고, 「배송은 도착했는데 상태는 이동
 * 중」인 화면이 남는다.
 *
 * **집화(`PICKED_UP`)가 `READY` 인 것이 유일하게 이름이 어긋나 보이는 칸이다.**
 * 운송장은 발송 처리와 함께 나오고 그 순간 집화가 남으므로 `READY` 는 「아직 아무 일도
 * 없다」가 아니라 「받아 갔고 아직 간선에 오르지 않았다」다 — 그보다 앞선 상태는
 * 존재할 수 없다.
 */
const STATUS_AFTER: Readonly<Record<TrackingEventKind, ShipmentStatus>> = {
  PICKED_UP: 'READY',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
}

export function shipmentStatusAfter(kind: TrackingEventKind): ShipmentStatus {
  return STATUS_AFTER[kind]
}

/**
 * 둘 중 **더 나아간** 상태 (F6).
 *
 * 배송 상태는 사다리다. 사건은 늦게 도착할 수 있고 두 번 도착할 수도 있지만,
 * **요약은 뒤로 가지 않는다** — 「배송완료」를 본 사람의 화면이 「이동 중」으로
 * 되돌아가면 그 화면은 그때부터 아무 말도 못 한다. 게다가 주문 쪽에는 애초에
 * 되돌아가는 화살표가 없어(`sellerOrderTransitions`), 배송만 내려오면 두 표가 서로
 * 다른 말을 하게 된다.
 *
 * 순위를 따로 적지 않고 `shipmentStatuses` 의 **순서를 그대로 읽는** 이유는 그
 * 순서가 이미 뜻이기 때문이다 — 계약이 그렇게 선언했고(`api/shipments.ts`),
 * 진행 표시(`packages/ui`)도 그 순서로 단계를 센다. 순위표를 한 벌 더 두면 언젠가
 * 둘이 다른 말을 하고, 그때 어느 쪽이 맞는지 아무도 모른다.
 */
export function furthestShipmentStatus(
  current: ShipmentStatus,
  next: ShipmentStatus,
): ShipmentStatus {
  return shipmentStatuses.indexOf(next) > shipmentStatuses.indexOf(current) ? next : current
}

/**
 * 운송사별 집화 터미널. **가상 지명이다** (CLAUDE.md 6장 · F7).
 *
 * 운송사마다 다른 이름인 것은 화면 때문이다 — 추적 타임라인의 첫 줄이 늘 같은
 * 지명이면 그 칸은 아무것도 말하지 않는 장식이 된다.
 */
const PICKUP_HUB: Readonly<Record<DemoCarrierCode, string>> = {
  GA: '가온물류 남부터미널',
  HD: '한들택배 중앙집하장',
  SB: '새벽로지스 서부허브',
  NR: '나루배송 동부물류센터',
}

export function pickupHubOf(code: DemoCarrierCode): string {
  return PICKUP_HUB[code]
}

/**
 * 이력 한 줄에 적히는 문장.
 *
 * 서버가 만드는 이유는 이것이 UI 문구가 아니라 **기록**이기 때문이다. 실제 택배에서도
 * 이 칸은 운송사가 적어 보내는 값이고, 앱의 메시지 파일로 옮기면 **지난 이벤트의
 * 문장이 앱을 고칠 때마다 바뀐다** — 그때 추적 이력은 「그때 무슨 일이 있었나」에
 * 답하지 못하게 된다.
 */
const EVENT_DESCRIPTION: Readonly<Record<TrackingEventKind, string>> = {
  PICKED_UP: '판매자로부터 상품을 인수했어요.',
  IN_TRANSIT: '다음 터미널로 이동하고 있어요.',
  OUT_FOR_DELIVERY: '배송기사가 상품을 가지고 출발했어요.',
  DELIVERED: '상품이 배송 완료됐어요.',
}

export function trackingEventDescriptionOf(kind: TrackingEventKind): string {
  return EVENT_DESCRIPTION[kind]
}
