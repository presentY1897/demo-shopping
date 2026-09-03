import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/** The account icon's destination. M04 replaces this file. */
export default function MyPage() {
  const messages = messagesFor().placeholder.mypage

  return <PlaceholderScreen body={messages.body} title={messages.title} />
}
