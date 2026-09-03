import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/** The cart icon's destination. M07 replaces this file. */
export default function CartPage() {
  const messages = messagesFor().placeholder.cart

  return <PlaceholderScreen body={messages.body} title={messages.title} />
}
