/**
 * 밀도 3단계가 실제로 보이는 첫 컴포넌트 (TASK-0040 6.1).
 *
 * F1 은 표를 그대로 검사한다 — 어떤 항목이 어느 단계에서 보이는가. 이 표가
 * 이 TASK 의 전부이므로, 「보인다」를 눈으로 확인하는 대신 단계마다 걸어 본다.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DENSITY_GRID_COLUMNS, DENSITY_LEVELS } from '../density/density'
import type { DensityLevel } from '../density/density'
import { discountPercent, ProductCard, ratingOf } from './product-card'
import type { ProductCardLabels, ProductCardProduct } from './product-card'
import { gridColumnsClass, gridImageSizes, ProductGrid } from './product-grid'

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
  name: '데일리 코튼 티셔츠',
  brandName: '해뜰녘',
  price: 29_900,
  listPrice: 39_900,
  imageUrl: 'https://cdn.test.invalid/a.jpg',
  ratingAvg: 450,
  ratingCount: 12,
  salesCount: 340,
  colors: ['#111111', '#eeeeee'],
  inStock: true,
  remainingStock: 3,
}

function renderCard(density: DensityLevel, overrides: Partial<ProductCardProduct> = {}) {
  return render(
    <ProductCard
      density={density}
      href="/products/p1"
      labels={labels}
      product={{ ...product, ...overrides }}
    />,
  )
}

describe('F1 — 밀도별 표시 항목', () => {
  it('상품명과 가격은 세 단계 모두 보인다', () => {
    for (const density of DENSITY_LEVELS) {
      const { unmount } = renderCard(density)

      expect(screen.getByRole('link', { name: '데일리 코튼 티셔츠 상세 보기' })).toBeVisible()
      expect(screen.getByText('₩29,900')).toBeVisible()
      unmount()
    }
  })

  it('할인율은 표준부터 나온다', () => {
    const { unmount } = renderCard(1)

    expect(screen.queryByText('25%')).toBeNull()
    unmount()

    for (const density of [2, 3] as const) {
      const view = renderCard(density)

      expect(screen.getByText('25%')).toBeVisible()
      view.unmount()
    }
  })

  it('평점은 표준부터, 리뷰 수는 맥시멀에서만', () => {
    const minimal = renderCard(1)

    expect(screen.queryByText('4.5')).toBeNull()
    minimal.unmount()

    const standard = renderCard(2)

    expect(screen.getByText('4.5')).toBeVisible()
    expect(screen.queryByText('리뷰 12')).toBeNull()
    standard.unmount()

    renderCard(3)
    expect(screen.getByText('리뷰 12')).toBeVisible()
  })

  it('색상 칩은 표준부터 나온다', () => {
    const minimal = renderCard(1)

    expect(screen.queryByRole('list', { name: '데일리 코튼 티셔츠 색상' })).toBeNull()
    minimal.unmount()

    renderCard(2)
    const swatches = screen.getByRole('list', { name: '데일리 코튼 티셔츠 색상' })

    expect(within(swatches).getAllByRole('listitem')).toHaveLength(2)
  })

  it('판매량과 잔여 재고는 맥시멀에서만', () => {
    const standard = renderCard(2)

    expect(screen.queryByText('340개 판매')).toBeNull()
    expect(screen.queryByText('3개 남음')).toBeNull()
    standard.unmount()

    renderCard(3)
    expect(screen.getByText('340개 판매')).toBeVisible()
    expect(screen.getByText('3개 남음')).toBeVisible()
  })

  it('브랜드는 미니멀에서도 문서에 있다 — 숨기는 것은 눈이지 스크린 리더가 아니다', () => {
    // 호버로 드러나는 정보를 DOM 에서 빼면, 호버가 없는 사람에게는 그냥 사라진
    // 정보가 된다.
    renderCard(1)

    expect(screen.getByText('해뜰녘')).toBeInTheDocument()
  })
})

describe('빠른 담기 (맥시멀 전용)', () => {
  it('맥시멀에서만, 그리고 핸들러가 있을 때만 나온다', async () => {
    const onQuickAdd = vi.fn()

    for (const density of [1, 2] as const) {
      const view = render(
        <ProductCard
          density={density}
          href="/x"
          labels={labels}
          onQuickAdd={onQuickAdd}
          product={product}
        />,
      )

      expect(screen.queryByRole('button', { name: '바로 담기' })).toBeNull()
      view.unmount()
    }

    render(
      <ProductCard
        density={3}
        href="/x"
        labels={labels}
        onQuickAdd={onQuickAdd}
        product={product}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: '바로 담기' }))

    expect(onQuickAdd).toHaveBeenCalledWith('p1')
  })

  it('품절이면 담을 것이 없으므로 내지 않는다', () => {
    render(
      <ProductCard
        density={3}
        href="/x"
        labels={labels}
        onQuickAdd={vi.fn()}
        product={{ ...product, inStock: false }}
      />,
    )

    expect(screen.queryByRole('button', { name: '바로 담기' })).toBeNull()
    expect(screen.getByText('품절')).toBeVisible()
  })

  it('찜하기는 핸들러를 주지 않으면 자리도 만들지 않는다', () => {
    renderCard(3)

    expect(screen.queryByRole('button', { name: /찜하기/ })).toBeNull()
  })
})

describe('discountPercent', () => {
  it('내림한다 — 29.6%를 30%라고 하면 더 준 척하는 것이다', () => {
    expect(discountPercent(29_900, 39_900)).toBe(25)
    expect(discountPercent(7_040, 10_000)).toBe(29)
  })

  it('정가가 없거나 더 싸면 할인이 아니다', () => {
    expect(discountPercent(10_000, null)).toBeNull()
    expect(discountPercent(10_000, undefined)).toBeNull()
    expect(discountPercent(10_000, 10_000)).toBeNull()
    expect(discountPercent(10_000, 9_000)).toBeNull()
  })
})

describe('ratingOf', () => {
  it('100분율 정수를 별점으로 되돌린다', () => {
    expect(ratingOf(450)).toBe(4.5)
    expect(ratingOf(500)).toBe(5)
  })

  it('평가가 없으면 별을 그리지 않는다', () => {
    expect(ratingOf(0)).toBeNull()
    expect(ratingOf(undefined)).toBeNull()
  })
})

describe('F2 — 열 수는 매트릭스를 따른다', () => {
  it('세 단계 모두 매트릭스와 같은 클래스를 낸다', () => {
    // 숫자를 여기에 적지 않는다. 매트릭스가 움직이면 이 검사도 함께 움직인다.
    for (const density of DENSITY_LEVELS) {
      const columns = DENSITY_GRID_COLUMNS[density]
      const classes = gridColumnsClass(density)

      expect(classes, String(density)).toContain(`grid-cols-${String(columns.base)}`)
      expect(classes, String(density)).toContain(`md:grid-cols-${String(columns.md)}`)
      expect(classes, String(density)).toContain(`xl:grid-cols-${String(columns.xl)}`)
    }
  })

  it('F2b — 모바일 맥시멀은 2열이다', () => {
    expect(DENSITY_GRID_COLUMNS[3].base).toBe(2)
    expect(gridColumnsClass(3)).toContain('grid-cols-2')
  })

  it('sizes 는 넓은 뷰포트부터 적어야 브라우저가 읽는다', () => {
    const sizes = gridImageSizes(3)

    expect(sizes.indexOf('1280px')).toBeLessThan(sizes.indexOf('768px'))
    // 6열이면 한 칸이 16vw 다.
    expect(sizes).toContain('16vw')
  })

  it('그리드는 이름을 가진 목록이다', () => {
    render(
      <ProductGrid density={2} label="검색 결과">
        <li>하나</li>
      </ProductGrid>,
    )

    expect(screen.getByRole('list', { name: '검색 결과' })).toBeVisible()
  })
})
