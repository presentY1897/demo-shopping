/**
 * 상품 카드와 목록 (TASK-0040).
 *
 * Presentational only. Nothing here knows the API's shapes — `packages/ui` has
 * no dependency on `@shopping/shared` and this is not the place to start one, so
 * an app maps its own response onto `ProductCardProduct`. That is also what lets
 * search, a category page and the home page share one card.
 */

export { discountPercent, ProductCard, ratingOf } from './product-card'
export type { ProductCardLabels, ProductCardProduct, ProductCardProps } from './product-card'
export { gridColumnsClass, gridImageSizes, ProductGrid } from './product-grid'
export type { ProductGridProps } from './product-grid'
export { ProductList, ProductListSkeleton } from './product-list'
export type { ProductListLabels, ProductListProps } from './product-list'
