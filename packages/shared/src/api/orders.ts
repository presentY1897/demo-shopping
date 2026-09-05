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

export const orderListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.int().min(1).max(50).optional(),
})

export type OrderListQuery = z.infer<typeof orderListQuerySchema>

/**
 * 같은 질의를, 값이 전부 문자열로 도착하는 형태로.
 *
 * 타입이 있는 쪽 옆에 두는 이유는 둘이 갈리지 않게 하기 위해서다 — 한쪽에만
 * 파라미터를 더하면 컴파일이 멈춘다(`stock.ts` 가 같은 이유로 같은 모양이다).
 */
export const orderListQueryParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
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
   * 상태와 배송이 그것이다. 주문서는 아직 주문이 아니므로 상태가 없고, 발송된 적도 없다.
   */
  sellerOrders: z.array(
    sellerOrderSchema.omit({ id: true, status: true, shipment: true }).extend({
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
