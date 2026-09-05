import { ko } from './ko'
import { myPageErrorCodes } from './types'
import type {
  AddressBookMessages,
  AddressFormErrorMessages,
  AddressFormMessages,
  AuthDenialMessages,
  AuthMessages,
  AuthOutcomeMessages,
  CategoryMessages,
  DemoMessages,
  DensityControlMessages,
  DensitySettingMessages,
  FooterMessages,
  HealthMessages,
  HomeMessages,
  LayoutMessages,
  Messages,
  MyPageErrorCode,
  MyPageMessages,
  MyPageNavMessages,
  NavMessages,
  NotificationSettingMessages,
  PlaceholderMessages,
  ProductBadgeMessages,
  ProductDetailMessages,
  ProductGalleryMessages,
  ProductInfoMessages,
  ProductOptionMessages,
  ProductPurchaseMessages,
  ProfileFormMessages,
  RequireSignInMessages,
  RouteStateMessages,
  SearchFilterMessages,
  SearchMessages,
  SearchPriceMessages,
  SearchReadinessMessages,
  SearchSlotMessages,
  SearchSortMessages,
  SettingsMessages,
  SignInMessages,
  UserMenuMessages,
  WakeMessages,
  WithdrawalMessages,
} from './types'

/** Korean first (DECISIONS 1장). Other locales are added to `catalogs`. */
export const DEFAULT_LOCALE = 'ko'

export type Locale = keyof typeof catalogs

const catalogs = { ko } as const satisfies Record<string, Messages>

export function messagesFor(locale: Locale = DEFAULT_LOCALE): Messages {
  return catalogs[locale]
}

export { myPageErrorCodes }

export type {
  AddressBookMessages,
  AddressFormErrorMessages,
  AddressFormMessages,
  AuthDenialMessages,
  AuthMessages,
  AuthOutcomeMessages,
  CategoryMessages,
  DemoMessages,
  DensityControlMessages,
  DensitySettingMessages,
  FooterMessages,
  HealthMessages,
  HomeMessages,
  LayoutMessages,
  Messages,
  MyPageErrorCode,
  MyPageMessages,
  MyPageNavMessages,
  NavMessages,
  NotificationSettingMessages,
  PlaceholderMessages,
  ProductBadgeMessages,
  ProductDetailMessages,
  ProductGalleryMessages,
  ProductInfoMessages,
  ProductOptionMessages,
  ProductPurchaseMessages,
  ProfileFormMessages,
  RequireSignInMessages,
  RouteStateMessages,
  SearchFilterMessages,
  SearchMessages,
  SearchPriceMessages,
  SearchReadinessMessages,
  SearchSlotMessages,
  SearchSortMessages,
  SettingsMessages,
  SignInMessages,
  UserMenuMessages,
  WakeMessages,
  WithdrawalMessages,
}
