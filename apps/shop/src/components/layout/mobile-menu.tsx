'use client'

/**
 * The phone's navigation: a button in the header, a sheet from the bottom.
 *
 * A bottom sheet rather than a side drawer because the trigger is at the top of
 * a screen held in one hand and the choices should not be (TASK-0018 2장 lists
 * 햄버거·바텀시트). Radix Dialog underneath, so focus is trapped while it is
 * open, Escape closes it, the page behind is inert, and focus returns to the
 * hamburger afterwards — none of which this file arranges.
 *
 * **Its contents exist only while it is open.** That is what keeps the category
 * list from being rendered twice: the header's own list is mounted only on wide
 * viewports (D-055, `useViewportBand`), and this one only while the sheet is up.
 */

import { Drawer, IconButton } from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useCategoryMenu } from '@/lib/categories/use-category-menu'
import type { LayoutMessages } from '@/messages'

import { MenuIcon } from './icons'
import { NavLink } from './nav-link'
import { SearchSlot } from './search-slot'

export function MobileMenu({ messages }: { readonly messages: LayoutMessages }) {
  const [open, setOpen] = useState(false)
  const categories = useCategoryMenu()

  // The sheet has to close itself: the route changes under it and Radix has no
  // reason to know that happened.
  const close = useCallback(() => {
    setOpen(false)
  }, [])

  return (
    <Drawer
      closeLabel={messages.nav.closeMenu}
      description={messages.nav.menuDescription}
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      title={messages.nav.menuTitle}
      trigger={
        <IconButton label={messages.nav.openMenu} size="sm" variant="ghost">
          <MenuIcon className="size-5" />
        </IconButton>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        <SearchSlot messages={messages.search} />

        {/*
          Two levels, nested (TASK-0042 R1). The sheet has the height a header
          row does not, so the children are listed inline rather than behind a
          second tap — a phone menu that needs two taps to reach 코트 is a menu
          people use the search field instead of.
        */}
        <nav aria-label={messages.nav.label}>
          <ul className="flex flex-col gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <NavLink
                  className="min-h-touch text-fg hover:bg-surface-muted flex items-center rounded-md px-3 font-medium"
                  href={`/categories/${category.slug}`}
                  onNavigate={close}
                  pendingLabel={messages.nav.pendingLabel}
                >
                  {category.name}
                </NavLink>

                {category.children.length === 0 ? null : (
                  <ul className="flex flex-col">
                    {category.children.map((child) => (
                      <li key={child.id}>
                        <NavLink
                          className="min-h-touch text-fg-muted hover:bg-surface-muted flex items-center rounded-md pr-3 pl-6 text-sm"
                          href={`/categories/${child.slug}`}
                          onNavigate={close}
                          pendingLabel={messages.nav.pendingLabel}
                        >
                          {child.name}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Drawer>
  )
}
