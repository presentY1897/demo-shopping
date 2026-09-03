import { ko } from './ko'
import type {
  CategoryMessages,
  HealthMessages,
  Messages,
  SearchReadinessMessages,
  WakeMessages,
} from './types'

/** Korean first (DECISIONS 1장). Other locales are added to `catalogs`. */
export const DEFAULT_LOCALE = 'ko'

export type Locale = keyof typeof catalogs

const catalogs = { ko } as const satisfies Record<string, Messages>

export function messagesFor(locale: Locale = DEFAULT_LOCALE): Messages {
  return catalogs[locale]
}

export type { CategoryMessages, HealthMessages, Messages, SearchReadinessMessages, WakeMessages }
