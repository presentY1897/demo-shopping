/**
 * 재검증 주기 — 페이지와 그 페이지가 부르는 요청이 **같은 값을 쓴다** (TASK-0102).
 *
 * Two numbers that must agree and live apart is how a page ends up exporting
 * `revalidate = 60` while the fetch inside it says `no-store`, which makes the
 * page's own number inert.
 *
 * **The page cannot import these.** Next requires a segment's `revalidate` to be
 * a literal it can read without running the module, and rejects an imported
 * constant outright. So the number *is* written twice — and `isr-window.spec.ts`
 * compares the two, which is the enforcement this module cannot be.
 *
 * The windows are chosen by how wrong the page can afford to be:
 *
 * | | 초 | 왜 |
 * | --- | --- | --- |
 * | 상품 상세 | 60 | 가격·재고가 움직인다. 그마저도 화면이 마운트 뒤에 다시 읽는다(R2) |
 * | 카테고리·판매자 | 300 | 카탈로그의 뼈대다. 하루에 몇 번 바뀐다 |
 * | 사이트맵 | 3600 | 크롤러가 그보다 자주 오지 않는다 |
 */

export const PRODUCT_REVALIDATE_SECONDS = 60
export const CATALOGUE_REVALIDATE_SECONDS = 300
export const SITEMAP_REVALIDATE_SECONDS = 3600
