import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { ProductListWorkspace } from '@/components/catalog/product-list-workspace'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/products')

export const metadata: Metadata = {
  title,
  description: messages.adminProducts.description,
}

/**
 * `/products` — 모든 스토어의 상품, 그리고 강제로 내리기 (TASK-0095).
 *
 * 아무것도 `await` 하지 않는다. 제목과 설명은 이 서버 컴포넌트의 것이고 목록은
 * 클라이언트 경계가 효과에서 읽는다 — 차가운 인스턴스가 깨어나는 동안에도 화면의
 * 뼈대가 먼저 도착한다 (TASK-0101 4.3 · P5).
 *
 * 목록의 문이 `/admin` 밖에 있다는 것(`GET /products`)은 화면에서 보이지 않는다.
 * 누가 무엇을 볼 수 있는지는 퍼미션 표가 정하지 URL 이 정하지 않으므로
 * (`lib/catalog/console-api.ts`), 이 라우트는 관리자의 축으로 그 문을 부를 뿐이다.
 */
export default function ProductsPage() {
  const { adminProducts, errors } = messagesFor()

  return (
    <>
      <PageHeader description={adminProducts.description} title={title} />

      <ProductListWorkspace errors={errors} messages={adminProducts} />
    </>
  )
}
