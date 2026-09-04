import { ko } from './ko'
import type {
  AuthDenialMessages,
  AuthMessages,
  AuthOutcomeMessages,
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
  RequireSignInMessages,
  SearchSlotMessages,
  SignInMessages,
  UserMenuMessages,
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
  AuthDenialMessages,
  AuthMessages,
  AuthOutcomeMessages,
  DensityControlMessages,
  FooterMessages,
  HealthMessages,
  HomeMessages,
  LayoutMessages,
  Messages,
  NavMessages,
  PlaceholderMessages,
  RouteStateMessages,
  RequireSignInMessages,
  SearchReadinessMessages,
  SearchSlotMessages,
  SignInMessages,
  UserMenuMessages,
  WakeMessages,
}
