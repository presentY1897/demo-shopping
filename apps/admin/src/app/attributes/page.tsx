import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { AttributeManager } from '@/components/attributes/attribute-manager'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.attributes.title,
  description: messages.attributes.description,
}

/**
 * `/attributes` — where a category's product form is defined (TASK-0031).
 *
 * **This is where D-005 stops being a claim.** "카테고리·속성은 관리자 화면에서
 * 추가·설정 가능" is checkable here and nowhere else: an operator adds a
 * definition and the preview beside it becomes the form a seller will fill in,
 * with no deploy in between.
 *
 * Static, like the console's other pages: nothing is awaited here, so the shell
 * is prerendered and the definitions are fetched by the client boundary below
 * (TASK-0101 4.3). A server render that awaited the API would send no markup at
 * all for as long as a cold instance takes to wake.
 */
export default function AttributesPage() {
  const { attributes, errors, errorNotice } = messagesFor()

  return (
    <>
      <PageHeader description={attributes.description} title={attributes.title} />

      <AttributeManager errors={errors} messages={attributes} notice={errorNotice} />
    </>
  )
}
