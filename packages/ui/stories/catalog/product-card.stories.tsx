/**
 * `ProductCard` — 밀도 3단계가 실제로 보이는 첫 컴포넌트 (TASK-0040).
 *
 * The three levels are not three components. Every field arrives at every
 * level and only the rendering changes, which is what makes the toggle instant
 * and keeps one cache instead of three (4장).
 *
 * The card also sizes itself from **its container**, not the viewport: a
 * one-column card on a phone is wider than a six-column card on a desktop, so
 * reading the viewport would be wrong in both. Resize the canvas and the same
 * story reflows.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { ProductCard, ProductGrid } from '../../src/catalog'
import type { ProductCardLabels, ProductCardProduct } from '../../src/catalog'
import { DENSITY_LEVELS } from '../../src/density'
import { Stack } from '../support/layout'

const labels: ProductCardLabels = {
  openLabel: '{name} 상세 보기',
  soldOut: '품절',
  discount: '{percent}%',
  reviewCount: '리뷰 {count}',
  salesCount: '{count}개 판매',
  remaining: '{count}개 남음',
  wishlist: '{name} 찜하기',
  quickAdd: '바로 담기',
  colorsLabel: '{name} 색상',
  ratingLabel: '평점',
}

const product: ProductCardProduct = {
  id: 'p1',
  name: '데일리 코튼 오버핏 티셔츠',
  brandName: '해뜰녘',
  price: 29_900,
  listPrice: 39_900,
  imageUrl: null,
  ratingAvg: 450,
  ratingCount: 128,
  salesCount: 340,
  colors: ['#1a1a1a', '#f4f1ea', '#2f4858'],
  inStock: true,
  remainingStock: 3,
}

const meta = {
  title: 'Catalog/ProductCard',
  component: ProductCard,
  tags: ['autodocs'],
  args: { product, labels, href: '/products/p1', density: 2 },
  argTypes: { density: { control: 'inline-radio', options: [...DENSITY_LEVELS] } },
} satisfies Meta<typeof ProductCard>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** 세 단계를 나란히. 항목이 늘어나는 것이 밀도의 전부다. */
export const Densities: Story = {
  render: (args) => (
    <Stack>
      {DENSITY_LEVELS.map((density) => (
        <div className="w-64" key={density}>
          <ProductCard {...args} density={density} />
        </div>
      ))}
    </Stack>
  ),
}

/** 품절은 이미지를 덮는다 — 담기 버튼도 함께 사라진다. */
export const SoldOut: Story = {
  args: { product: { ...product, inStock: false }, density: 3 },
  render: (args) => (
    <div className="w-56">
      <ProductCard {...args} onQuickAdd={() => undefined} />
    </div>
  ),
}

/** 맥시멀 6열. 좁은 칸에서도 항목이 겹치지 않아야 한다 (R1). */
export const MaximalGrid: Story = {
  render: (args) => (
    <ProductGrid density={3} label="상품 목록">
      {Array.from({ length: 6 }, (_unused, index) => (
        <li key={index}>
          <ProductCard
            {...args}
            density={3}
            onQuickAdd={() => undefined}
            onWishlist={() => undefined}
            product={{ ...product, id: `p${String(index)}` }}
          />
        </li>
      ))}
    </ProductGrid>
  ),
}
