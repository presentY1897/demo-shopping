import { consoleMenuItemAt } from '@shopping/ui/console'

import { ko } from './ko'
import type {
  AuthDenialMessages,
  AuthMessages,
  AuthOutcomeMessages,
  DemoMessages,
  ConsoleGuardMessages,
  ConsoleLayoutMessages,
  ImageUploadMessages,
  ImageUploadPreviewMessages,
  ConsolePlaceholderMessages,
  ConsoleSlotMessages,
  HealthMessages,
  Messages,
  ProductActionMessages,
  ProductAttributeSectionMessages,
  ProductBasicsMessages,
  ProductDiffMessages,
  ProductEditorMessages,
  ProductListMessages,
  ProductStockMessages,
  ProductGalleryMessages,
  ProductMissingMessages,
  ProductOptionMessages,
  ProductPreviewMessages,
  ProductToastMessages,
  ProductVariantMessages,
  RouteStateMessages,
  SearchReadinessMessages,
  SignInMessages,
  StoreAbsentMessages,
  StoreAvailabilityMessages,
  StoreConflictMessages,
  StoreFailureMessages,
  StoreFormMessages,
  StoreMessages,
  StoreStatusMessages,
  StoreStatusNoticeMessages,
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

/**
 * The sidebar label for a screen, used as its heading and its document title.
 *
 * Read out of the menu rather than repeated: the entry an operator clicked and
 * the heading they land on are the same words by construction, and a locale
 * that renames "주문 관리" renames both. A path with no entry of its own — a
 * detail screen, the component gallery — falls back to the console's name,
 * which is what the top bar does with the same path.
 */
export function screenTitle(href: string, locale: Locale = DEFAULT_LOCALE): string {
  const { layout } = messagesFor(locale)

  return consoleMenuItemAt(layout.menu, href)?.label ?? layout.brand
}

export type {
  AuthDenialMessages,
  AuthMessages,
  AuthOutcomeMessages,
  DemoMessages,
  ConsoleGuardMessages,
  ConsoleLayoutMessages,
  ImageUploadMessages,
  ImageUploadPreviewMessages,
  ConsolePlaceholderMessages,
  ConsoleSlotMessages,
  HealthMessages,
  Messages,
  ProductActionMessages,
  ProductAttributeSectionMessages,
  ProductBasicsMessages,
  ProductDiffMessages,
  ProductEditorMessages,
  ProductListMessages,
  ProductStockMessages,
  ProductGalleryMessages,
  ProductMissingMessages,
  ProductOptionMessages,
  ProductPreviewMessages,
  ProductToastMessages,
  ProductVariantMessages,
  RouteStateMessages,
  SearchReadinessMessages,
  SignInMessages,
  StoreAbsentMessages,
  StoreAvailabilityMessages,
  StoreConflictMessages,
  StoreFailureMessages,
  StoreFormMessages,
  StoreMessages,
  StoreStatusMessages,
  StoreStatusNoticeMessages,
  UserMenuMessages,
  WakeMessages,
}
