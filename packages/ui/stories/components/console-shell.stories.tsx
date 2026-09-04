/**
 * The seller and admin chrome: a sidebar, a top bar, and the page inside them.
 *
 * Two consoles, one shell — the menu is a prop, because `apps/seller` and
 * `apps/admin` own their own route tables (`docs/design/pages.md`) and M04 puts
 * a permission filter in front of the same definition.
 *
 * Things worth trying in the canvas:
 *
 * - **The toggle in the top bar does whatever "show me the navigation" means at
 *   this width.** Drag the preview narrower than 1024px and the same button
 *   opens a sheet instead of collapsing a column — one form is mounted at a
 *   time (D-055), never two with one hidden by CSS.
 * - **Tab from the very start.** The first stop is "본문 바로가기", which jumps
 *   past thirteen menu entries to the content — the reason the console needs a
 *   skip link even more than the storefront does.
 * - **The lit entry follows the path, not the click.** `Products` is the story
 *   below, and it is on `/products/new` — a screen that has no menu entry of
 *   its own, and still marks the section it belongs to.
 *
 * The density toolbar has no effect worth watching here: consoles are pinned to
 * step 2 and show no density control at all (D-033).
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'

import { Badge } from '../../src/components/badge'
import { Button } from '../../src/components/button'
import { ConsoleShell, PageHeader, type ConsoleMenu } from '../../src/console'

/** `apps/admin`'s menu, from the route table in `docs/design/pages.md` 3장. */
const MENU: ConsoleMenu = [
  { id: 'overview', items: [{ href: '/', label: '대시보드' }] },
  {
    id: 'operations',
    label: '운영',
    items: [
      { href: '/users', label: '회원 관리' },
      { href: '/sellers', label: '판매자 관리' },
      { href: '/products', label: '상품 관리' },
      { href: '/orders', label: '주문 관리' },
      { href: '/claims', label: '클레임 관리' },
    ],
  },
  {
    id: 'catalog',
    label: '카탈로그',
    items: [
      { href: '/categories', label: '카테고리 관리' },
      { href: '/attributes', label: '속성 관리' },
    ],
  },
  {
    id: 'settlement',
    label: '정산·프로모션',
    items: [
      { href: '/commissions', label: '수수료 설정' },
      { href: '/settlements', label: '정산 관리' },
    ],
  },
]

const LABELS = {
  closeNav: '메뉴 닫기',
  collapseSidebar: '사이드바 접기',
  expandSidebar: '사이드바 펼치기',
  navLabel: '주요 메뉴',
  navSheetDescription: '콘솔의 모든 화면을 여기에서 엽니다.',
  openNav: '메뉴 열기',
  skipToContent: '본문 바로가기',
}

/**
 * Stands in for `next/link`.
 *
 * The shell takes the link as a component prop precisely so that it never has
 * to know which router an app uses — which is what lets this story render it at
 * all, with no router in sight.
 */
function StoryLink({
  href,
  children,
  ...props
}: {
  readonly href: string
  readonly children: ReactNode
  readonly className?: string
  readonly 'aria-current'?: 'page'
  readonly onClick?: () => void
}) {
  return (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  )
}

function Console({
  currentPath,
  children,
}: {
  readonly currentPath: string
  readonly children: ReactNode
}) {
  return (
    <ConsoleShell
      brand="관리자 콘솔"
      currentPath={currentPath}
      labels={LABELS}
      linkComponent={StoryLink}
      menu={MENU}
      notifications={<Badge variant="neutral">알림 0</Badge>}
      userMenu={<Badge variant="primary">운영자</Badge>}
    >
      {children}
    </ConsoleShell>
  )
}

const meta = {
  title: 'Components/ConsoleShell',
  component: Console,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof Console>

export default meta

type Story = StoryObj<typeof meta>

/** A list screen: title, one primary action, a filter row. */
export const Categories: Story = {
  args: {
    currentPath: '/categories',
    children: (
      <>
        <PageHeader
          actions={<Button size="sm">카테고리 추가</Button>}
          description="상품이 걸리는 분류 트리를 편집합니다."
          filters={<Badge variant="neutral">비활성 포함</Badge>}
          title="카테고리 관리"
        />
        <p className="text-fg-muted text-sm">화면 내용이 여기에 들어갑니다.</p>
      </>
    ),
  },
}

/**
 * `/products/new` — a path with no menu entry of its own. The section it lives
 * in is what lights up, and the top bar names that section rather than the
 * screen (TASK-0019 4.5, 4.8).
 */
export const Products: Story = {
  args: {
    currentPath: '/products/new',
    children: <PageHeader description="새 상품을 등록합니다." title="상품 등록" />,
  },
}

/** No menu entry matches, so the top bar falls back to the console's name. */
export const OutsideTheMenu: Story = {
  args: {
    currentPath: '/components',
    children: <PageHeader title="기본 컴포넌트" />,
  },
}
