'use client'

/**
 * The storefront header — three forms of one row.
 *
 * | band | what is in the row |
 * | --- | --- |
 * | ~767 | hamburger · logo · density · cart · account |
 * | 768~1279 | hamburger · logo · search · density · cart · account |
 * | 1280~ | logo · categories · search · density · cart · account |
 *
 * The category list only fits beside a search field at the widest band, so the
 * two narrower ones keep the menu sheet — which is a normal tablet pattern and
 * avoids a header that wraps to two rows at 768px.
 *
 * **One form is mounted at a time** (D-055), and all three are exactly
 * `h-control-lg` tall. The height matters more than it looks: the server cannot
 * know the viewport, so it renders the narrow form and a desktop visitor is
 * swapped over at hydration. Equal heights make that swap invisible instead of
 * a layout shift on every first load (TASK-0018 4.4).
 */

import { PageContainer, useViewportBand } from '@shopping/ui/layout'

import type { LayoutMessages } from '@/messages'

import { DensityControl } from './density-control'
import { AccountIcon, CartIcon } from './icons'
import { MobileMenu } from './mobile-menu'
import { NavLink } from './nav-link'
import { SearchSlot } from './search-slot'

export function ShopHeader({
  brand,
  messages,
}: {
  readonly brand: string
  readonly messages: LayoutMessages
}) {
  const band = useViewportBand()
  // The search field appears one band before the category list does: at 768px
  // the two together wrap the row onto a second line.
  const compact = band === 'base'
  const inlineCategories = band === 'xl'

  return (
    <header className="bg-surface border-border sticky top-0 z-30 border-b">
      <PageContainer className="h-control-lg flex items-center gap-2">
        {inlineCategories ? null : <MobileMenu messages={messages} />}

        <NavLink
          className="min-h-touch text-fg flex shrink-0 items-center rounded-md px-2 text-lg font-bold whitespace-nowrap"
          href="/"
          pendingLabel={messages.nav.pendingLabel}
        >
          {brand}
        </NavLink>

        {inlineCategories ? <CategoryNav messages={messages} /> : null}

        {compact ? (
          // The search field moves into the menu sheet on a phone: six controls
          // do not fit across 360px, and the field is the one that survives
          // being one tap away.
          <div className="flex-1" />
        ) : (
          <SearchSlot className="min-w-0 flex-1" messages={messages.search} />
        )}

        <div className="flex shrink-0 items-center gap-1">
          <DensityControl messages={messages.density} />

          <IconLink
            href="/cart"
            label={messages.account.cart}
            pendingLabel={messages.nav.pendingLabel}
          >
            <CartIcon className="size-5" />
          </IconLink>

          <IconLink
            href="/mypage"
            label={messages.account.mypage}
            pendingLabel={messages.nav.pendingLabel}
          >
            <AccountIcon className="size-5" />
          </IconLink>
        </div>
      </PageContainer>
    </header>
  )
}

function CategoryNav({ messages }: { readonly messages: LayoutMessages }) {
  return (
    <nav aria-label={messages.nav.label} className="min-w-0">
      <ul className="flex items-center">
        {messages.nav.categories.map((category) => (
          <li key={category.slug}>
            <NavLink
              className="min-h-touch text-fg-muted hover:text-fg hover:bg-surface-muted flex items-center rounded-md px-3 text-sm whitespace-nowrap"
              href={`/categories/${category.slug}`}
              pendingLabel={messages.nav.pendingLabel}
            >
              {category.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * An icon link whose name comes from text, not from `aria-label`.
 *
 * Visually hidden text rather than a label attribute so that voice control
 * ("장바구니 클릭") matches something on screen, and so the pending indicator
 * inside the link keeps its own announcement instead of being flattened into an
 * overriding name.
 */
function IconLink({
  href,
  label,
  pendingLabel,
  children,
}: {
  readonly href: string
  readonly label: string
  readonly pendingLabel: string
  readonly children: React.ReactNode
}) {
  return (
    <NavLink
      className="size-control-md touch-target text-fg hover:bg-surface-muted inline-flex items-center justify-center rounded-md"
      href={href}
      pendingLabel={pendingLabel}
    >
      {children}
      <span className="sr-only">{label}</span>
    </NavLink>
  )
}
