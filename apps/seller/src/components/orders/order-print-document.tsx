import type { OrderStatus, SellerOrderResponse } from '@shopping/shared'

import { dateTime, money } from '@/lib/orders/format'
import type { OrderPrintMessages } from '@/messages'

/**
 * 종이로 나가는 주문서 (2장 「인쇄용 뷰」).
 *
 * **화면의 컴포넌트를 쓰지 않는다.** 배지·버튼·탭은 종이에서 아무 일도 하지 않고,
 * 인쇄에서 필요한 것은 상자에 붙일 수 있는 한 장이다 — 무엇을 몇 개, 누구에게,
 * 어느 운송장으로.
 *
 * 순수 렌더다. `window.print()` 를 부르는 것은 이 파일이 아니라 **누른 화면**이고,
 * 그 덕에 이 컴포넌트는 목록의 일괄 인쇄와 상세의 한 장짜리 인쇄에 같은 모양으로
 * 실린다.
 *
 * **「가상 데모 주문서」가 붙어 있다.** 실제 거래 증빙처럼 보이는 종이가 프린터에서
 * 나오는 것이 이 화면의 유일한 위험이고, 운송장 번호의 `DEMO-` 접두어와 같은 이유로
 * 여기에도 문장이 하나 필요하다.
 */
export interface OrderPrintDocumentProps {
  readonly order: SellerOrderResponse
  readonly messages: OrderPrintMessages
  readonly statusLabels: Readonly<Record<OrderStatus, string>>
}

export function OrderPrintDocument({ order, messages, statusLabels }: OrderPrintDocumentProps) {
  const { sellerOrder } = order

  return (
    <article
      // 한 주문서가 한 장이다. 둘이 한 장에 걸치면 잘라 붙일 수 없다.
      className="break-after-page flex flex-col gap-4 p-6 text-sm"
      aria-label={`${messages.documentTitle} ${order.orderNumber}`}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{messages.documentTitle}</h2>
        <p>
          {messages.orderNumber}: {order.orderNumber}
        </p>
        <p>
          {messages.orderedAt}: {dateTime(order.orderedAt)}
        </p>
        <p>{statusLabels[sellerOrder.status]}</p>
        {sellerOrder.shipment === null ? null : (
          <p>
            {messages.tracking}: {sellerOrder.shipment.trackingNumber}
          </p>
        )}
      </header>

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">{messages.recipient}</h3>
        <p>{order.recipient.name}</p>
        <p>
          {messages.phone}: {order.recipient.phone}
        </p>
        <p>
          {messages.address}: [{order.recipient.postalCode}] {order.recipient.addressLine1}{' '}
          {order.recipient.addressLine2 ?? ''}
        </p>
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">{messages.items}</h3>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th scope="col">{messages.items}</th>
              <th scope="col">{messages.option}</th>
              <th scope="col">{messages.quantity}</th>
              <th scope="col">{messages.unitPrice}</th>
              <th scope="col">{messages.amount}</th>
            </tr>
          </thead>
          <tbody>
            {sellerOrder.items.map((item) => (
              <tr key={item.id}>
                <td>{item.snapshot.productName}</td>
                <td>{item.snapshot.optionLabel}</td>
                <td>{item.quantity}</td>
                <td>{money(item.unitPrice)}</td>
                <td>{money(item.productAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-1">
        <p>
          {messages.total}: {money(sellerOrder.productAmount)}
        </p>
        <p>
          {messages.shippingFee}: {money(sellerOrder.shippingFee)}
        </p>
        <p className="font-medium">
          {messages.paidAmount}: {money(sellerOrder.paidAmount)}
        </p>
      </section>

      <footer>
        <p>{messages.notice}</p>
      </footer>
    </article>
  )
}
