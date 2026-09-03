/**
 * `useInfiniteScroll` — a sentinel, and the button that has to exist beside it.
 *
 * A hook rather than a component, because the sentinel belongs *inside* the
 * caller's list: a wrapper element between a `<ul>` and its `<li>`s is invalid
 * markup and breaks the list semantics a screen reader counts.
 *
 * The "더 보기" button is not a fallback for old browsers. It is the keyboard
 * path (QUALITY-GATES U5) — an infinite list that only loads on scroll cannot be
 * operated without scrolling, and it is also what runs when
 * `IntersectionObserver` is missing (a server render, a test).
 *
 * There is no `rootMargin` prop. Prefetch distance is where the caller *puts*
 * the sentinel, which keeps a pixel string out of an app's source and out of the
 * hardcoded-length check.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useState } from 'react'

import { Button, Card, Grid, Skeleton, useInfiniteScroll } from '../../src/components'
import { Stack } from '../support/layout'

const PAGE_SIZE = 6
const TOTAL = 24

function ProductFeed() {
  const [count, setCount] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(false)

  const hasMore = count < TOTAL

  const onLoadMore = useCallback(() => {
    setLoading(true)
    // Stands in for a request. A real screen would refetch with the cursor the
    // previous page returned.
    globalThis.setTimeout(() => {
      setCount((current) => Math.min(TOTAL, current + PAGE_SIZE))
      setLoading(false)
    }, 400)
  }, [])

  const { sentinelRef, supported } = useInfiniteScroll({ hasMore, loading, onLoadMore })

  return (
    <Stack>
      <Grid as="ul">
        {Array.from({ length: count }, (_, index) => (
          <Card as="li" key={index} variant="outline">
            <p className="text-fg text-sm font-medium">{`Product ${String(index + 1)}`}</p>
          </Card>
        ))}
        {/* The sentinel is a list item so the list stays a list. */}
        <li aria-hidden="true" ref={sentinelRef} />
      </Grid>

      {loading ? <Skeleton label="Loading more products" lines={2} /> : null}

      {hasMore ? (
        <Button loading={loading} onClick={onLoadMore} variant="outline">
          Load more
        </Button>
      ) : (
        <p className="text-fg-muted text-sm">{`All ${String(TOTAL)} products loaded.`}</p>
      )}

      <p className="text-fg-subtle text-xs">
        {supported
          ? 'IntersectionObserver is available — scrolling to the end loads the next page.'
          : 'IntersectionObserver is unavailable — the button is the only way forward.'}
      </p>
    </Stack>
  )
}

const meta = {
  title: 'Components/InfiniteScroll',
  component: ProductFeed,
  tags: ['autodocs'],
} satisfies Meta<typeof ProductFeed>

export default meta

type Story = StoryObj<typeof meta>

export const Feed: Story = {}
