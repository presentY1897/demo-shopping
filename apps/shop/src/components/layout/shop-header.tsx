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

import { Popover } from '@shopping/ui/components'
import { PageContainer, useViewportBand } from '@shopping/ui/layout'

import { UserMenu } from '@/components/auth/user-menu'
import { useCartCount } from '@/lib/cart/cart-count'
import { useCategoryMenu } from '@/lib/categories/use-category-menu'
import type { LayoutMessages } from '@/messages'
import { messagesFor } from '@/messages'

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
      {/*
        `gap-1` and the `sm` controls below are not cosmetic. At 360px with the
        minimal step the spacing unit is 5px, which makes a `control-md` button
        55px wide; four of those plus the logo overflow the row by 20px, which a
        real browser showed and no unit test would have (TASK-0018 6.1 F5).
      */}
      <PageContainer className="h-control-lg flex items-center gap-1">
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

          <CartLink label={messages.account.cart} pendingLabel={messages.nav.pendingLabel} />

          {/*
            Was a plain link to `/mypage` until TASK-0023. It is a menu now
            because the header has to offer three things — the account screen,
            signing in, and signing out — and a fourth control would overflow the
            row at 360px, which is the measurement the `gap-1` comment above
            records. The destination it used to link to is the menu's first
            entry, under the same name.
          */}
          <UserMenu
            icon={<AccountIcon className="size-5" />}
            messages={messagesFor().auth.menu}
            myPageLabel={messages.account.mypage}
          />
        </div>
      </PageContainer>
    </header>
  )
}

/**
 * The catalogue, two levels deep (TASK-0042 R1).
 *
 * A dropdown per root rather than a flat row: 40 categories over three levels is
 * a menu nobody reads, and the third level is listed on the category page itself
 * where there is a heading to say what it belongs to.
 *
 * The trigger is a **button**, not a link — a control that both navigates and
 * opens a panel does one of them by accident on every keyboard. The root's own
 * page is the first entry inside, under 「{name} 전체」, so nothing is
 * unreachable.
 *
 * The list is empty until the tree arrives; see `useCategoryMenu` for why it is
 * fetched in the browser rather than rendered on the server.
 */
function CategoryNav({ messages }: { readonly messages: LayoutMessages }) {
  const categories = useCategoryMenu()
  const copy = messagesFor().category

  return (
    <nav aria-label={messages.nav.label} className="min-w-0">
      <ul className="flex items-center">
        {categories.map((category) =>
          category.children.length === 0 ? (
            <li key={category.id}>
              <NavLink
                className="min-h-touch text-fg-muted hover:text-fg hover:bg-surface-muted flex items-center rounded-md px-3 text-sm whitespace-nowrap"
                href={`/categories/${category.slug}`}
                pendingLabel={messages.nav.pendingLabel}
              >
                {category.name}
              </NavLink>
            </li>
          ) : (
            <li key={category.id}>
              <Popover
                align="start"
                title={category.name}
                trigger={
                  <button
                    className="min-h-touch text-fg-muted hover:text-fg hover:bg-surface-muted flex items-center rounded-md px-3 text-sm whitespace-nowrap"
                    type="button"
                  >
                    {category.name}
                  </button>
                }
              >
                <ul className="flex min-w-48 flex-col">
                  <li>
                    <NavLink
                      className="min-h-touch text-fg hover:bg-surface-muted flex items-center rounded-md px-3 text-sm font-medium"
                      href={`/categories/${category.slug}`}
                      pendingLabel={messages.nav.pendingLabel}
                    >
                      {copy.allOfLabel.replace('{name}', category.name)}
                    </NavLink>
                  </li>
                  {category.children.map((child) => (
                    <li key={child.id}>
                      <NavLink
                        className="min-h-touch text-fg-muted hover:text-fg hover:bg-surface-muted flex items-center rounded-md px-3 text-sm"
                        href={`/categories/${child.slug}`}
                        pendingLabel={messages.nav.pendingLabel}
                      >
                        {child.name}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </Popover>
            </li>
          ),
        )}
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
/**
 * 장바구니 링크와 담긴 줄 수 (TASK-0046).
 *
 * **숫자를 모를 때는 그리지 않는다.** `0` 과 「아직 안 읽었다」를 같게 두면 로그인
 * 직후의 한순간에 「0」이 보이고, 담아 둔 것이 있는 사람에게 그것은 거짓말이다.
 *
 * 배지는 `aria-hidden` 이고 링크의 이름에 수를 넣는다 — 아이콘 옆의 작은 숫자를
 * 따로 읽어 주면 「장바구니 3」이 아니라 「장바구니」 「3」 두 덩어리로 들린다.
 */
function CartLink({
  label,
  pendingLabel,
}: {
  readonly label: string
  readonly pendingLabel: string
}) {
  const count = useCartCount()

  return (
    <NavLink
      className="size-control-sm touch-target text-fg hover:bg-surface-muted relative inline-flex items-center justify-center rounded-md"
      href="/cart"
      pendingLabel={pendingLabel}
    >
      <CartIcon className="size-5" />
      {count === null || count === 0 ? null : (
        <span
          aria-hidden="true"
          className="bg-accent text-on-accent absolute top-0 right-0 min-w-4 rounded-full px-1 text-center text-xs leading-4 font-semibold tabular-nums"
        >
          {count}
        </span>
      )}
      <span className="sr-only">
        {count === null || count === 0 ? label : `${label} ${String(count)}`}
      </span>
    </NavLink>
  )
}
