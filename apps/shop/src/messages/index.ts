import { ko } from './ko'
import type {
  DensityControlMessages,
  FooterMessages,
  HealthMessages,
  HomeMessages,
  LayoutMessages,
  Messages,
  NavMessages,
  PlaceholderMessages,
  RouteStateMessages,
  SearchReadinessMessages,
  SearchSlotMessages,
  WakeMessages,
} from './types'

/** Korean first (DECISIONS 1장). Other locales are added to `catalogs`. */
export const DEFAULT_LOCALE = 'ko'

export type Locale = keyof typeof catalogs

const catalogs = { ko } as const satisfies Record<string, Messages>

export function messagesFor(locale: Locale = DEFAULT_LOCALE): Messages {
  return catalogs[locale]
}

export type {
  DensityControlMessages,
  FooterMessages,
  HealthMessages,
  HomeMessages,
  LayoutMessages,
  Messages,
  NavMessages,
  PlaceholderMessages,
  RouteStateMessages,
  SearchReadinessMessages,
  SearchSlotMessages,
  WakeMessages,
}
