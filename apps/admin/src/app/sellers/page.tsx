import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { SellerConsoleTabs } from '@/components/sellers/seller-console-tabs'
import { messagesFor, screenTitle } from '@/messages'

const messages = messagesFor()

const title = screenTitle('/sellers')

export const metadata: Metadata = {
  title,
  description: messages.sellers.description,
}

/**
 * `/sellers` — 입점 심사(TASK-0110)와 스토어 지표·제재 이력(TASK-0094).
 *
 * Static, like the console's other pages: nothing is awaited here, so the shell
 * is prerendered and each tab's data is fetched by the client boundary below
 * (TASK-0101 4.3). A server render that awaited the API would send no markup at
 * all for as long as a cold instance takes to wake, which is up to ninety
 * seconds.
 *
 * **제목이 사이드바에서 나온다.** 이 라우트가 두 가지를 하게 되면서 「입점 심사」는
 * 페이지의 이름이 아니라 **탭 하나의 이름**이 되었다. 메뉴가 부르는 이름과 도착한
 * 화면의 제목이 같아야 한다는 것은 `screenTitle` 이 이미 하고 있던 약속이다
 * (`/users` 와 같은 방식).
 *
 * The route also belongs to M12 (개별 수수료율) in `docs/design/pages.md`; that
 * one adds to this screen rather than replacing it.
 */
export default function SellersPage() {
  const { sellers, stores, errors, errorNotice } = messagesFor()

  return (
    <>
      <PageHeader description={sellers.description} title={title} />

      <SellerConsoleTabs errors={errors} messages={sellers} notice={errorNotice} stores={stores} />
    </>
  )
}
