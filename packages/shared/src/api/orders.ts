import { z } from 'zod'

import { addressLineSchema, phoneSchema, recipientNameSchema } from './profile.js'
import { priceSchema, productIdSchema, variantIdSchema } from './products.js'
import { shipmentSchema } from './shipments.js'

/**
 * 주문의 계약 (TASK-0049).
 *
 * **2단이다** (D-023). `Order` 는 결제 단위이고 `SellerOrder` 는 배송·취소·정산의
 * 단위다. 상태가 뒤쪽에 붙는 것이 이 구조의 전부다 — 판매자 A 는 배송완료인데 B 는
 * 준비중일 수 있어야 하고, B 만 취소할 수 있어야 한다.
 *
 * **항목은 스냅샷을 든다.** 상품이 삭제되거나 데모 판매자가 만료돼도(TASK-0025)
 * 주문 이력은 온전해야 한다. 그래서 이 응답의 상품명·옵션·이미지는 지금
 * `Product` 가 뭐라고 하든 **주문한 때의 것**이다.
 */

/**
 * 한 판매자 몫의 주문 상태 (`docs/design/state-machines.md` 1장).
 *
 * 이 TASK 가 만드는 것은 `PAYMENT_PENDING` 하나뿐이다. 나머지는 결제(M08)와
 * 상태 전이(M09)가 채운다 — 열거형을 지금 전부 적어 두는 이유는, 화면이
 * `Record<OrderStatus, string>` 으로 문장을 갖게 하면 상태가 늘 때 **타입 검사가**
 * 빠진 문장을 잡기 때문이다.
 */
export const orderStatuses = [
  'PAYMENT_PENDING',
  'PAYMENT_FAILED',
  'PAID',
  'PREPARING',
  'SHIPPED',
  'DELIVERED',
  'CONFIRMED',
  'CANCELED',
  'RETURNED',
] as const

export type OrderStatus = (typeof orderStatuses)[number]

export const orderStatusSchema = z.enum(orderStatuses)

/**
 * 목록을 상태로 좁힐 때 보내는 것 — **목록이다.**
 *
 * 탭 하나가 상태 하나라는 보장이 없기 때문이다: 판매자 콘솔의 「취소·반품」 탭은
 * `CANCELED` 와 `RETURNED` 둘이고, 구매자의 「결제 대기」는 `PAYMENT_PENDING` 과
 * `PAYMENT_FAILED` 둘이다. 서버에 탭 이름을 주는 대신 상태 목록을 주면 탭의 정의는
 * 화면에 남고(설계서가 그것을 소유한다), API 는 어느 화면에서 불려도 같은 뜻을 갖는다.
 *
 * **두 목록(`/orders` · `/seller-orders`)이 같은 스키마를 쓴다.** 문법이 갈리면 —
 * 한쪽은 쉼표, 한쪽은 반복 키 — 그 차이를 설명할 수 있는 사람이 아무도 없다.
 */
export const orderStatusFilterSchema = z.array(orderStatusSchema).min(1).max(orderStatuses.length)

/** 주문번호의 형식. `Order_orderNumber_format_check` 가 같은 것을 DB 에서 지킨다. */
export const ORDER_NUMBER_PATTERN = /^[0-9]{8}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/u

export const orderNumberSchema = z.string().regex(ORDER_NUMBER_PATTERN)

/**
 * 주문한 때의 상품.
 *
 * 필요한 것만 담는다 (R2). 이미지는 대표 1장이고, 없으면 `null` 이다 — 「사진이
 * 없었다」는 사실도 스냅샷의 일부다.
 */
export const orderItemSnapshotSchema = z.object({
  productId: productIdSchema,
  productName: z.string(),
  /** `블랙 / M`. 옵션이 없으면 빈 문자열이다. */
  optionLabel: z.string(),
  sku: z.string(),
  thumbnailUrl: z.string().nullable(),
  brandName: z.string(),
})

export type OrderItemSnapshot = z.infer<typeof orderItemSnapshotSchema>

export const orderItemSchema = z.object({
  id: z.uuid(),
  variantId: variantIdSchema,
  snapshot: orderItemSnapshotSchema,
  /** 주문한 때의 단가. 지금 가격이 아니다. */
  unitPrice: priceSchema,
  quantity: z.int().min(1),
  productAmount: priceSchema,
  /** 이 항목에 안분된 몫 (`pricing.md` 2장). 부분 취소가 읽는 값이다. */
  couponDiscountAmount: priceSchema,
  pointDiscountAmount: priceSchema,
  discountAmount: priceSchema,
})

export type OrderItem = z.infer<typeof orderItemSchema>

/**
 * 전이를 일으킨 주체 — **역할이 아니다** (`state-machines.md` 1장).
 *
 * `SYSTEM` 이 그 차이를 만든다: 배송 시뮬레이터와 D+7 자동 확정에는 사람이 없다.
 * 서버(`seller-order-transitions.ts`)와 이 계약이 **같은 목록**을 쓰는 이유는,
 * 이력이 화면까지 나가는 순간 그 값이 두 곳에 적히기 때문이다 — 갈라지면 콘솔이
 * 자기가 모르는 주체를 만나 아무 문장도 못 고른다.
 */
export const orderActors = ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'] as const

export type OrderActor = (typeof orderActors)[number]

export const orderActorSchema = z.enum(orderActors)

/**
 * 상태 이력 한 줄 (TASK-0059 가 적고 TASK-0060 이 처음 읽는다).
 *
 * **누가 옮겼는지가 이 줄의 값이다.** 분쟁에서 근거가 되는 것은 「언제 배송중이
 * 됐나」가 아니라 「누가 그렇게 적었나」이고, 그래서 `actor` 는 선택이 아니다.
 * 사람이 없는 전이는 `actorId` 가 `null` 이지 `actor` 가 비는 것이 아니다.
 */
export const sellerOrderHistoryEntrySchema = z.object({
  id: z.uuid(),
  /** 주문이 처음 생긴 줄에는 이전 상태가 없다. */
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema,
  actor: orderActorSchema,
  reason: z.string().nullable(),
  occurredAt: z.iso.datetime(),
})

export type SellerOrderHistoryEntry = z.infer<typeof sellerOrderHistoryEntrySchema>

/** 한 판매자 몫. 배송·취소·정산이 이 단위로 일어난다. */
export const sellerOrderSchema = z.object({
  id: z.uuid(),
  sellerId: z.uuid(),
  /** 주문한 때의 브랜드명. 스토어가 이름을 바꿔도 주문서는 그대로다. */
  brandName: z.string(),
  status: orderStatusSchema,
  items: z.array(orderItemSchema),
  productAmount: priceSchema,
  couponDiscountAmount: priceSchema,
  pointDiscountAmount: priceSchema,
  /**
   * 배송비를 낸 적립금 (TASK-0047).
   *
   * 항목에 안분되지 **않는** 몫이라 따로 있다. 항목의 안분액을 전부 더해도 이 값이
   * 빠져 있으므로, 「적립금을 얼마 썼나」는 항목의 합이 아니라 이것을 더한 값이다.
   */
  shippingPointAmount: priceSchema,
  shippingFee: priceSchema,
  paidAmount: priceSchema,
  /**
   * 이 몫의 배송, 아직 발송 전이면 `null` (TASK-0061).
   *
   * **목록이 아니라 상세에만 실린다.** 목록은 상태 배지 하나면 되고, 묶음마다
   * 추적 이력을 딸려 보내면 응답이 몇 배가 된다.
   *
   * `null` 은 「배송 정보를 못 읽었다」가 아니라 **「아직 발송되지 않았다」**다 —
   * 화면은 그 둘을 다르게 그려야 하므로 이 필드를 선택적으로 두지 않는다.
   */
  shipment: shipmentSchema.nullable(),
  /**
   * 이 몫이 지나온 상태들, 오래된 것부터 (TASK-0059 가 적고 TASK-0060 이 처음 읽는다).
   *
   * **`shipment` 바로 옆에 있는 이유가 이 필드의 정의다.** 둘 다 *묶음*에 붙는
   * 사실이고 둘 다 *상세에만* 실린다 — 상태가 판매자 몫마다 따로 움직이므로
   * (D-023) 「이 주문의 이력」이라는 것은 없고, 목록의 스무 줄마다 딸려 보내면
   * 응답이 몇 배가 된다.
   *
   * 여기 있으면 **판매자와 구매자가 같은 이력을 읽는다.** 응답 최상위에 두었을
   * 때는 판매자 상세에만 닿았고, 그래서 구매자의 「주문 상태 타임라인」은 이력이
   * 아니라 사다리였다 — 근거가 있는데 못 쓰는 상태였다.
   *
   * 주문서(`checkoutSchema`)에는 없다. 주문이 된 뒤에 생기는 것이라, `status`·
   * `shipment` 와 함께 `omit` 된다.
   */
  history: z.array(sellerOrderHistoryEntrySchema),
  /**
   * 이 몫이 자동으로 구매확정되는 시각, 또는 예정이 없으면 `null` (TASK-0064 F8).
   *
   * **서버가 계산해서 준다.** 규칙(배송완료 D+7)은 공개된 약속이라 화면이 이력에서
   * 직접 더할 수도 있지만, 그러면 **데모에서 그 날짜가 틀린다** — 배포가
   * `FULFILLMENT_PACE=demo` 면 배송도 확정도 시간이 압축되고(배송완료 5분 뒤),
   * 그 설정은 어떤 응답에도 실리지 않아 화면이 알 방법이 없다. 화면이 계산하면
   * 압축된 배포에서 「7일 뒤」라고 적어 놓고 5분 뒤에 확정되는 일이 벌어지고,
   * 사람은 화면이 거짓말했다고 읽는다.
   *
   * `null` 인 경우는 둘이다. **배송완료가 아닌 몫**(아직 오는 중이거나 이미 확정·
   * 취소·반품으로 끝난 몫)은 자동 확정을 기다리고 있지 않고, **배송완료인데 그
   * 시각을 모르는 몫**은 지어낼 근거가 없다. 화면은 그 둘을 같게 다뤄도 된다 —
   * 어느 쪽이든 말할 수 있는 날짜가 없다.
   *
   * 기준 시각은 **상태 이력의 `DELIVERED` 줄**이지 배송 행의 `deliveredAt` 이
   * 아니다. 이유는 `apps/api/src/orders/order-confirm.service.ts` 에 적혀 있다 —
   * 요약하면 이력은 반드시 있고 배송 행은 뒤처질 수 있으며, D+7 이 재는 것은
   * 「상태가 배송완료로 선언된 뒤 얼마나 지났나」이기 때문이다.
   */
  autoConfirmAt: z.iso.datetime().nullable(),
})

export type SellerOrder = z.infer<typeof sellerOrderSchema>

/** 수령인. 주문한 때 배송지에서 **복사한** 값이다 (TASK-0049 4.6). */
export const orderRecipientSchema = z.object({
  name: z.string(),
  phone: z.string(),
  postalCode: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
})

export type OrderRecipient = z.infer<typeof orderRecipientSchema>

export const orderSchema = z.object({
  id: z.uuid(),
  orderNumber: orderNumberSchema,
  createdAt: z.iso.datetime(),
  recipient: orderRecipientSchema,
  sellerOrders: z.array(sellerOrderSchema),
  totalProductAmount: priceSchema,
  totalCouponDiscountAmount: priceSchema,
  totalPointDiscountAmount: priceSchema,
  totalShippingFee: priceSchema,
  paidAmount: priceSchema,
})

export type Order = z.infer<typeof orderSchema>

export const orderResponseSchema = z.object({ order: orderSchema })

export type OrderResponse = z.infer<typeof orderResponseSchema>

/* ------------------------------------------ 판매자 콘솔의 주문 (TASK-0060) -- */

/**
 * 판매자가 읽는 자기 몫 하나.
 *
 * `orderResponseSchema` 를 걸러서 주지 않는 이유는 **주문 단위 합계 때문**이다.
 * 그 숫자는 주문 전체의 것이고, 남의 몫이 섞여 있다. 걸러서 주면 합계가 항목과
 * 맞지 않고, 합계를 다시 계산해서 주면 그 숫자는 아무 데도 저장된 적이 없는 값이다.
 * 그래서 판매자에게는 **판매자의 단위**를 준다.
 */
export const sellerOrderResponseSchema = z.object({
  sellerOrder: sellerOrderSchema,
  /** 어느 주문의 몫인가. 문의를 받는 쪽이 번호로 찾는다. */
  orderNumber: orderNumberSchema,
  orderedAt: z.iso.datetime(),
  recipient: orderRecipientSchema,
  // 이력은 여기 없다. **`sellerOrder.history` 다** — 묶음에 붙는 사실이라 묶음
  // 안에 있고, 그래야 구매자 상세(`orderSchema.sellerOrders`)에서도 같은 이력이
  // 읽힌다. 두 곳에 두면 언젠가 다른 말을 한다.
})

export type SellerOrderResponse = z.infer<typeof sellerOrderResponseSchema>

/**
 * 전이가 요구하는 것 — 상태만으로는 부족한 조건 (TASK-0059 F4).
 *
 * 지금은 하나뿐인데도 목록인 이유는, 조건을 불리언 하나로 쓰면 화면이 「무엇이
 * 모자란가」를 필드 이름으로 알아야 하기 때문이다. 이름으로 오면 화면은 그 이름에
 * 붙은 입력에 오류를 띄울 수 있다.
 */
export const sellerOrderRequirements = ['tracking'] as const

export type SellerOrderRequirement = (typeof sellerOrderRequirements)[number]

export const sellerOrderRequirementSchema = z.enum(sellerOrderRequirements)

/** 사유의 상한. 이력에 남는 한 줄이고, 문서가 아니다. */
export const SELLER_ORDER_TRANSITION_REASON_MAX_LENGTH = 200

/**
 * `POST /seller-orders/:id/transitions` — 이 몫을 다음 상태로 옮긴다.
 *
 * **주체(`actor`)를 받지 않는다.** 요청한 사람이 그 주문의 판 사람인지 산 사람인지는
 * 서버가 확인해서 **정한다** — 부르는 쪽이 자기 주체를 주장하게 두면 구매자가
 * `SYSTEM` 을 주장할 수 있고, 그러면 결제로만 열리는 전이가 HTTP 로 열린다.
 */
export const sellerOrderTransitionRequestSchema = z.object({
  to: orderStatusSchema,
  /** 왜 옮겼는가. 취소·반품에는 있고 정상 진행에는 없다. */
  reason: z.string().min(1).max(SELLER_ORDER_TRANSITION_REASON_MAX_LENGTH).optional(),
})

export type SellerOrderTransitionRequest = z.infer<typeof sellerOrderTransitionRequestSchema>

/**
 * 지금 이 사람이 누를 수 있는 버튼 하나.
 *
 * **조건이 모자란 전이도 목록에 들어온다** (`enabled: false`). 운송장이 없다고 발송
 * 버튼을 감추면 판매자는 그 버튼을 **찾다가** 포기한다 — 버튼은 보이고, 누르면
 * 무엇이 필요한지 말해 주는 편이 낫다. `blockedBy` 가 그 「무엇」이다.
 */
export const sellerOrderActionSchema = z.object({
  to: orderStatusSchema,
  /** 지금 바로 되는가. `false` 면 `blockedBy` 가 채워져 있다. */
  enabled: z.boolean(),
  blockedBy: sellerOrderRequirementSchema.nullable(),
})

export type SellerOrderAction = z.infer<typeof sellerOrderActionSchema>

/**
 * `GET /seller-orders/:id/actions` — 화면이 상태로 분기하지 않게 하는 답 (F7).
 *
 * 「`PAID` 면 발송 버튼」을 화면에 적으면 그 판단이 세 앱에 흩어지고, 규칙이 바뀔 때
 * 한 곳만 고쳐진다. 서버가 「지금 할 수 있는 것」을 답하면 화면은 그것을 그린다.
 */
export const sellerOrderActionsResponseSchema = z.object({
  status: orderStatusSchema,
  actions: z.array(sellerOrderActionSchema),
})

export type SellerOrderActionsResponse = z.infer<typeof sellerOrderActionsResponseSchema>

/**
 * 전이 요청의 답.
 *
 * `changed` 가 따로 있는 이유는 **멱등** 때문이다. 이미 목표 상태인 몫에 다시 요청이
 * 오면 성공으로 답하지만 아무것도 옮기지 않았고, 화면이 「처리했습니다」와 「이미
 * 처리돼 있었습니다」를 다르게 말할 수 있어야 한다.
 *
 * `actions` 를 함께 싣는 것은 왕복을 하나 줄이기 위해서다 — 상태가 바뀌면 버튼도
 * 반드시 바뀌므로, 두 번 묻는 화면은 그 사이에 낡은 버튼을 그린다.
 */
export const sellerOrderTransitionResponseSchema = z.object({
  id: z.uuid(),
  status: orderStatusSchema,
  changed: z.boolean(),
  actions: z.array(sellerOrderActionSchema),
})

export type SellerOrderTransitionResponse = z.infer<typeof sellerOrderTransitionResponseSchema>

/**
 * `POST /orders` — 주문 생성.
 *
 * **장바구니 줄을 가리킨다.** 상품과 수량을 다시 받지 않는 이유는, 그러면 화면이
 * 보여 준 것과 다른 것을 주문할 수 있기 때문이다 — 담긴 것이 무엇인지는 서버가
 * 이미 안다.
 *
 * 수량은 여기 없다. 바꾸려면 장바구니에서 바꾼다(`PATCH /cart/items/:id`) — 두
 * 곳에서 수량을 받으면 어느 쪽이 이기는지를 정해야 하고, 그 규칙은 아무도 기억하지
 * 못한다.
 */
export const createOrderRequestSchema = z
  .object({
    /** 주문할 장바구니 줄. 선택한 것만 주문한다 (TASK-0046 F2). */
    itemIds: z.array(z.uuid()).min(1).max(100).optional(),
    /**
     * 이미 열린 주문서 (TASK-0050 4.3).
     *
     * 오면 **그 예약을 그대로 쓴다.** 두 번 잡으면 한 사람이 같은 물건을 두 몫
     * 잠근다. 지켜야 하는 성질은 「주문에는 그것을 덮는 `HELD` 예약이 있다」이지
     * 「예약이 어디서 잡혔나」가 아니다.
     */
    checkoutId: z.uuid().optional(),
    /** 어느 배송지로. 값은 복사되고 이 id 는 주문에 남지 않는다. */
    addressId: z.uuid(),
  })
  // 둘 중 정확히 하나. 둘 다 보내면 어느 쪽이 이기는지를 정해야 하고, 그 규칙은
  // 아무도 기억하지 못한다.
  .refine(
    (input) => (input.itemIds === undefined) !== (input.checkoutId === undefined),
    '주문할 줄이나 주문서 중 하나만 보내 주세요.',
  )

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>

/** 주문 목록의 한 줄. 상세를 열지 않고도 그릴 수 있을 만큼만. */
export const orderSummarySchema = z.object({
  id: z.uuid(),
  orderNumber: orderNumberSchema,
  createdAt: z.iso.datetime(),
  /**
   * 대표 상품명과 나머지 개수 — 「울 코트 외 2건」.
   *
   * 목록이 항목을 전부 싣지 않는 이유는 A5 다: 주문 20건의 항목을 모두 실으면
   * 한 화면이 수백 줄을 내려받는다.
   */
  headline: z.string(),
  itemCount: z.int().min(0),
  /**
   * 판매자별 상태. 하나로 뭉치지 않는다 — 「배송중」과 「준비중」이 섞인 주문이
   * 이 구조의 정상이고, 하나만 보여 주면 그 사실이 사라진다.
   */
  statuses: z.array(orderStatusSchema),
  paidAmount: priceSchema,
})

export type OrderSummary = z.infer<typeof orderSummarySchema>

export const orderListResponseSchema = z.object({
  orders: z.array(orderSummarySchema),
  /** 다음 페이지의 커서. 없으면 마지막이다. */
  nextCursor: z.string().nullable(),
})

export type OrderListResponse = z.infer<typeof orderListResponseSchema>

export const ORDER_LIST_DEFAULT_LIMIT = 20

export const ORDER_LIST_MAX_LIMIT = 50

/**
 * `GET /api/v1/orders` 의 질의 — 상태·기간·커서 (TASK-0063 2장).
 *
 * **판매자 목록(`sellerOrderListQuerySchema`)과 같은 문법이다.** 상태는 쉼표로
 * 이어진 목록, 기간은 `from`·`to` 의 ISO 시각, 경계는 양쪽 다 포함. 두 목록이 서로
 * 다른 문법을 쓰면 그 차이를 설명할 수 있는 사람이 아무도 없다.
 *
 * ## 상태 필터의 뜻: 「이 상태인 묶음이 **하나라도** 있는 주문」
 *
 * 한 주문에 판매자별 묶음이 여럿이고 상태가 서로 다르다 (D-023). 그래서 「이
 * 주문의 상태」라는 것이 없고, 필터의 뜻을 둘 중에서 골라야 한다 — **하나라도**
 * (합집합)인가, **전부**(교집합)인가.
 *
 * 화면의 탭이 무엇을 뜻해야 하는지로 정했다. 「배송중」 탭을 누르는 사람이 찾는
 * 것은 **지금 오고 있는 물건**이다. 배송완료·배송중·상품준비중이 섞인 주문은
 * 「전부」로 치면 어느 탭에도 걸리지 않아 「전체」에서만 보이는데, 그 주문이야말로
 * 이 저장소의 구조가 사용자에게 드러나는 자리다 — 사람은 그것을 「배송중」에서
 * 찾고, 거기 없으면 화면이 고장난 줄 안다.
 *
 * 서버가 이 뜻을 갖는다: `SellerOrder` 에 `some` 조건을 건다 (`order.service.ts`).
 *
 * ## 검색(`q`)은 받지 않는다
 *
 * 판매자 쪽 `q` 가 찾는 것은 주문번호와 **수령인 이름**인데, 구매자에게 수령인은
 * 언제나 자기 자신이라 절반이 뜻을 잃는다. 그리고 이 화면에는 검색 입력이 없다
 * (TASK-0063 2장은 기간·상태만 요구한다) — 아무도 부르지 않는 파라미터를 서버에
 * 두면 그것은 검증된 적 없는 코드가 된다. 필요해지면 그때 같은 문법으로 더한다.
 */
export const orderListQuerySchema = z.object({
  status: orderStatusFilterSchema.optional(),
  /** 이 시각 **이후**에 접수된 주문만. 화면이 고른 기간의 시작을 ISO 로 보낸다. */
  from: z.iso.datetime().optional(),
  /** 이 시각 **이전**. 경계는 양쪽 다 포함이다. */
  to: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  limit: z.int().min(1).max(ORDER_LIST_MAX_LIMIT).optional(),
})

export type OrderListQuery = z.infer<typeof orderListQuerySchema>

/**
 * 같은 질의를, 값이 전부 문자열로 도착하는 형태로.
 *
 * 타입이 있는 쪽 옆에 두는 이유는 둘이 갈리지 않게 하기 위해서다 — 한쪽에만
 * 파라미터를 더하면 컴파일이 멈춘다(`stock.ts` 가 같은 이유로 같은 모양이다).
 *
 * `status` 만 변환이 붙는다. 쿼리스트링에는 배열이 없고, 반복 키
 * (`?status=a&status=b`)는 프레임워크마다 다른 것으로 파싱되기 때문에 **쉼표
 * 하나**로 정했다 — `sellerOrderListQueryParamsSchema` 가 같은 이유로 같은 모양이고,
 * 두 목록이 같은 문법을 쓰는 것이 그 자체로 계약이다.
 */
export const orderListQueryParamsSchema = z.object({
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(orderStatusFilterSchema)
    .optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(ORDER_LIST_MAX_LIMIT).optional(),
})

/** 수령인을 만들 때 쓰는 검증 — 배송지 계약과 같은 규칙이다. */
export const orderRecipientInputSchema = z.object({
  name: recipientNameSchema,
  phone: phoneSchema,
  addressLine1: addressLineSchema,
})

export type OrderRecipientInput = z.infer<typeof orderRecipientInputSchema>

/**
 * 주문서 하나 (TASK-0050 4.1).
 *
 * **표가 아니다.** 같은 `checkoutId` 를 가진 `HELD` 예약들이 곧 주문서이고, 여기
 * 실리는 나머지는 그 예약이 가리키는 `ProductVariant` 에서 따라간 것이다. 표를 하나
 * 더 만들면 같은 사실이 두 곳에 살고, 갈리는 날 어느 쪽이 맞는지 아무도 모른다.
 *
 * 금액은 **서버가 계산 엔진으로 낸 값**이다. 장바구니는 같은 엔진을 브라우저에서
 * 부르므로 두 화면의 숫자가 같고(F5), 주문이 저장할 숫자도 같다.
 */
export const checkoutSchema = z.object({
  id: z.uuid(),
  /** 이 시각이 지나면 예약이 풀린다. 화면의 타이머가 읽는 값이다. */
  expiresAt: z.iso.datetime(),
  /**
   * 판매자별 몫. 주문이 저장할 모양 그대로다 — **주문이 된 뒤에 생기는 것들만 빠진다.**
   *
   * 상태와 배송과 이력, 그리고 자동 확정 예정일이 그것이다. 주문서는 아직 주문이
   * 아니므로 상태가 없고, 발송된 적도 없으며, 지나온 상태도 확정될 날짜도 없다.
   */
  sellerOrders: z.array(
    sellerOrderSchema
      .omit({
        id: true,
        status: true,
        shipment: true,
        history: true,
        autoConfirmAt: true,
      })
      .extend({
        items: z.array(orderItemSchema.omit({ id: true })),
      }),
  ),
  totalProductAmount: priceSchema,
  totalCouponDiscountAmount: priceSchema,
  totalPointDiscountAmount: priceSchema,
  totalShippingFee: priceSchema,
  paidAmount: priceSchema,
})

export type Checkout = z.infer<typeof checkoutSchema>

export const checkoutResponseSchema = z.object({ checkout: checkoutSchema })

export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>

/**
 * `POST /checkouts` — 고른 장바구니 줄로 주문서를 연다.
 *
 * **부르는 것은 장바구니의 「주문하기」다** (4.1). 주문서 화면이 진입과 동시에
 * 부르면 새로고침 한 번에 예약이 한 벌 더 잡힌다.
 */
export const createCheckoutRequestSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(100),
})

export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequestSchema>

/** 주문서에서 쓰는 배송 요청사항. 저장되는 곳은 아직 없다 — M09 의 배송이 받는다. */
export const CHECKOUT_NOTE_MAX_LENGTH = 100

/**
 * 판매자 목록의 한 줄.
 *
 * 상세를 열지 않고도 그릴 수 있을 만큼만 담는다 — `orderSummarySchema` 가 구매자
 * 쪽에서 하는 일과 같고, 담기는 것이 다른 이유는 **보는 사람이 다르기** 때문이다.
 * 판매자에게 필요한 것은 「내가 다음에 무엇을 해야 하나」이므로 상태·운송장이 있고,
 * 남의 몫이 섞인 주문 합계는 없다.
 *
 * **수령인 이름은 서버가 가린다** (`홍*동`). 화면이 가리는 구조로 두면 전체 이름이
 * 이미 브라우저에 도착해 있고, 그때 가림은 표시 취향이지 보호가 아니다 —
 * 개발자도구·확장·오류 보고가 전부 원본을 본다. 전체 이름이 필요한 자리는 상세
 * 하나뿐이고(`sellerOrderResponseSchema.recipient`), 그 요청은 한 건을 연 사람만
 * 보낸다.
 */
export const sellerOrderListItemSchema = z.object({
  id: z.uuid(),
  orderNumber: orderNumberSchema,
  orderedAt: z.iso.datetime(),
  status: orderStatusSchema,
  /** 「울 코트 외 2건」의 앞부분. 문장은 서버가 만든다. */
  headline: z.string(),
  itemCount: z.int().min(0),
  /** 항목 수량의 합. 「2건 3개」를 그리는 데 쓴다. */
  totalQuantity: z.int().min(0),
  paidAmount: priceSchema,
  /** 가려진 수령인 이름. 원본은 이 응답 어디에도 없다. */
  maskedRecipientName: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** 발송 전이면 `null`. 배송 상세는 목록에 싣지 않는다. */
  trackingNumber: z.string().nullable(),
})

export type SellerOrderListItem = z.infer<typeof sellerOrderListItemSchema>

export const sellerOrderListResponseSchema = z.object({
  sellerOrders: z.array(sellerOrderListItemSchema),
  /** 다음 페이지의 커서. 없으면 마지막이다. */
  nextCursor: z.string().nullable(),
})

export type SellerOrderListResponse = z.infer<typeof sellerOrderListResponseSchema>

export const SELLER_ORDER_LIST_DEFAULT_LIMIT = 20

export const SELLER_ORDER_LIST_MAX_LIMIT = 100

/**
 * 검색어의 상한.
 *
 * `productSearchSchema` 와 같은 이유로 묶여 있다 — 이 문자열은 PostgreSQL 에
 * `ILIKE` 패턴으로 도착하고, 길이가 없는 패턴은 한 판매자의 목록을 모두의 비용으로
 * 만드는 방법이다.
 */
export const SELLER_ORDER_SEARCH_MAX_LENGTH = 100

export const sellerOrderSearchSchema = z.string().trim().min(1).max(SELLER_ORDER_SEARCH_MAX_LENGTH)

/**
 * 판매자 목록의 상태 필터 — 구매자 목록과 **같은 스키마**다.
 *
 * 두 목록이 다른 문법을 쓰면 그 차이를 아무도 설명할 수 없다. 이름이 둘인 것은
 * 부르는 쪽의 읽기를 위해서이고, 값은 하나다 ({@link orderStatusFilterSchema} 가
 * 왜 목록인지를 설명한다).
 */
export const sellerOrderStatusFilterSchema = orderStatusFilterSchema

/** `GET /api/v1/seller-orders` 의 질의, 부르는 쪽이 쓰는 모양. */
export const sellerOrderListQuerySchema = z.object({
  status: sellerOrderStatusFilterSchema.optional(),
  /** 이 시각 **이후**에 접수된 주문만. 화면이 고른 날의 시작을 ISO 로 보낸다. */
  from: z.iso.datetime().optional(),
  /** 이 시각 **이전**. 경계는 양쪽 다 포함이다. */
  to: z.iso.datetime().optional(),
  /** 주문번호 또는 수령인 이름의 부분 일치. */
  q: sellerOrderSearchSchema.optional(),
  limit: z.int().min(1).max(SELLER_ORDER_LIST_MAX_LIMIT).optional(),
  cursor: z.uuid().optional(),
})

export type SellerOrderListQuery = z.infer<typeof sellerOrderListQuerySchema>

/**
 * 같은 질의를, 값이 전부 문자열로 도착하는 형태로.
 *
 * 타입이 있는 쪽 옆에 두는 이유는 둘이 갈리지 않게 하기 위해서다 — 한쪽에만
 * 파라미터를 더하면 컴파일이 멈춘다(`orderListQueryParamsSchema` 와 같은 모양).
 *
 * `status` 만 변환이 붙는다. 쿼리스트링에는 배열이 없고, 반복 키(`?status=a&status=b`)는
 * 프레임워크마다 다른 것으로 파싱되기 때문에 **쉼표 하나**로 정했다 — 검색의
 * `attr.<키>` 가 같은 이유로 같은 모양이다.
 */
export const sellerOrderListQueryParamsSchema = z.object({
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(sellerOrderStatusFilterSchema)
    .optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  q: sellerOrderSearchSchema.optional(),
  limit: z.coerce.number().int().min(1).max(SELLER_ORDER_LIST_MAX_LIMIT).optional(),
  cursor: z.uuid().optional(),
})

/**
 * `GET /api/v1/seller-orders/summary` — 뱃지와 탭이 읽는 숫자.
 *
 * **목록과 다른 요청인 것이 이 계약의 요점이다.** 같은 응답에 실으면 숫자가 필터를
 * 따라 움직이거나(그러면 뱃지가 아니다) 한 응답이 서로 다른 두 질문에 답하게 되고,
 * 페이지를 넘길 때마다 표 전체를 다시 센다. 뱃지가 필요한 자리는 목록이 아닌
 * 곳에도 있다 — 대시보드가 그렇고, 거기서 스무 줄을 받아 하나의 수를 얻는 것은
 * 낭비다.
 */
export const sellerOrderSummarySchema = z.object({
  /** 상태별 건수. **전 상태가 들어 있다** — 0건인 탭도 0을 받아야 그린다. */
  counts: z.record(orderStatusSchema, z.int().min(0)),
  /**
   * 신규 주문 — 결제는 끝났고 판매자가 아직 확인하지 않은 건.
   *
   * 어느 상태가 여기 세어지는지는 **서버가 정한다.** 화면이 `counts` 를 더해 만들면
   * 그 규칙이 대시보드·사이드바·목록 셋에 흩어지고, 상태가 하나 늘 때 한 곳만
   * 고쳐진다 — 「가능한 액션은 서버가 답한다」와 같은 판단이다.
   */
  newOrders: z.int().min(0),
  /** 처리 대기 — 판매자가 다음 행동을 해야 하는 건 전부. */
  actionRequired: z.int().min(0),
})

export type SellerOrderSummary = z.infer<typeof sellerOrderSummarySchema>

export const sellerOrderSummaryResponseSchema = z.object({ summary: sellerOrderSummarySchema })

export type SellerOrderSummaryResponse = z.infer<typeof sellerOrderSummaryResponseSchema>

/**
 * `POST /api/v1/seller-orders/:id/delivery` — 판매자의 「배송완료 처리」 (TASK-0060 4.3).
 *
 * **전이 라우트로 같은 일을 하면 배송 표가 따라오지 않는다** (TASK-0061 4.4):
 * 주문만 `DELIVERED` 로 가고 구매자의 추적 화면은 「이동 중」에 남는다. 그래서 이
 * 라우트가 따로 있고, 둘을 **한 트랜잭션**에서 옮긴다.
 *
 * 답이 둘인 것은 화면이 둘 다 그리기 때문이다 — 상태 배지와 버튼 목록은 전이의
 * 것이고, 추적 타임라인은 배송의 것이다. 한 번 더 물으면 그 사이의 화면이 낡은
 * 짝을 그린다.
 */
export const sellerOrderDeliveryResponseSchema = z.object({
  transition: sellerOrderTransitionResponseSchema,
  shipment: shipmentSchema,
})

export type SellerOrderDeliveryResponse = z.infer<typeof sellerOrderDeliveryResponseSchema>
