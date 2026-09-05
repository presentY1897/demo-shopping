'use client'

import type { CategoryTreeNode } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { fetchStorefrontCategories } from './storefront-api'

/**
 * The category tree, for the header (TASK-0042).
 *
 * **Fetched in the browser, and cached for the tab.** The header is on every
 * route, so reading the tree during the server render would make every page
 * dynamic — and TASK-0101 4.3 made the storefront's shell static on purpose, so
 * that a visitor gets markup while the API is still waking rather than waiting
 * for it and then timing out. The nav filling in a moment after paint is the
 * price of that, and it is the right side to pay on: an empty menu for a second
 * is recoverable, a blank page for thirty is not.
 *
 * One promise for the whole tab, held at module scope. The header remounts on
 * every band change (D-055 mounts one form at a time), and a fetch per mount
 * would be a request every time somebody resizes a window.
 */

let cached: Promise<readonly CategoryTreeNode[]> | null = null

function load(): Promise<readonly CategoryTreeNode[]> {
  cached ??= fetchStorefrontCategories()
    .then((answer) => answer.nodes)
    .catch(() => {
      // A menu that could not be loaded is a menu that is not shown — the logo,
      // the search field and the account menu all still work. Clearing the cache
      // means the next mount tries again rather than remembering the failure for
      // the life of the tab.
      cached = null

      return []
    })

  return cached
}

/** Test seam: the cache outlives a `cleanup()`, and specs need it not to. */
export function resetCategoryMenuCache(): void {
  cached = null
}

export function useCategoryMenu(): readonly CategoryTreeNode[] {
  const [nodes, setNodes] = useState<readonly CategoryTreeNode[]>([])

  useEffect(() => {
    let live = true

    void load().then((loaded) => {
      if (live) setNodes(loaded)
    })

    return () => {
      live = false
    }
  }, [])

  return nodes
}
