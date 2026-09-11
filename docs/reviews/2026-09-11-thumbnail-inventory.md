# 썸네일 전수 조사 — TASK 범위 확정 전

기준: main `250bf50`, 2026-09-11. 구매자·판매자·관리자 앱의 전체 src와 packages/ui/src에서 이미지 렌더러, 공통 컴포넌트 호출, CSS 배경 이미지, thumbnailUrl 계약과 소비자, API 생성 경로를 조사했다. 테스트·스토리는 운영 화면과 구분했다. 이 문서는 코드 전수 조사이며 모든 운영 URL의 HTTP 응답/디코딩 전수 검증 결과가 아니다.

사용자의 조사 우선 지시에 따라 기존 TASK0137과 세 화면 수정 커밋은 보류한다. 해당 코드는 로컬 브랜치에 보존되어 있고 PR/배포하지 않았다. 아래 범위를 바탕으로 TASK를 재작성하기 전 추가 구현하지 않는다.

## 1. 이미 표시하는 상품 이미지

경로는 저장소 루트 기준이며 아래 shop/seller/admin은 apps/<앱>/src/components를 뜻한다.

| 화면/용도 | 구현 경로 | 현재 처리 / 판단 |
| --- | --- | --- |
| 홈 상품 섹션·검색 결과 | shop/catalog/search-hit-card.tsx → packages/ui/src/catalog/product-card.tsx | URL 보정 + Next Image + 카드 실패 대체 있음. 기존 sizes/우선순위 유지 대상 |
| 상품 상세 큰 이미지·선택 썸네일 | shop/products/product-gallery.tsx | URL 보정과 실패 대체 있음. 확대/스와이프/선택은 갤러리 책임 유지 |
| 장바구니 | shop/cart/cart-line-row.tsx | ProductThumbnail 사용 |
| 결제 주문서 | shop/checkout/checkout-screen.tsx | ProductThumbnail, 주문 스냅샷 사용 |
| 구매자 주문 상세 | shop/mypage/seller-order-bundle.tsx | ProductThumbnail, 주문 스냅샷 사용 |
| 홈·상품 상세 최근 본 스트립 | shop/collections/recently-viewed-strip.tsx | raw img, null만 분기. URL 보정/오류 대체 누락 |
| 최근 본 전체 목록 | shop/collections/recent-screen.tsx | raw img, null만 분기. URL 보정/오류 대체 누락 |
| 찜 목록 | shop/collections/wishlist-screen.tsx | raw img, null만 분기. URL 보정/오류 대체 누락 |
| 판매자 저장된 상품 이미지 편집 | seller/products/product-image-field.tsx | raw img, URL 보정/로드 실패 대체 없음 |
| 판매자 상품 미리보기 | seller/products/product-preview.tsx | 이미지 배열이 비면 안내, 개별 URL 로드 실패 대체 없음 |
| 판매자 업로드 미리보기 | seller/product-images/product-image-uploader.tsx → packages/ui/src/media/image-upload-list.tsx | blob 등 previewUrl 사용. 업로드 실패 상태와 이미지 디코딩 실패는 별개이며 img onError 없음 |

최근 본 상품은 비로그인 localStorage와 로그인 API 경로가 같은 화면 컴포넌트로 모인다. 상품 상세에서 저장하는 이미지 URL도 원본이다. 저장 기록을 지우는 대신 표시 시 처리하면 과거 이력도 보호할 수 있다.

## 2. 데이터가 있지만 썸네일을 표시하지 않는 후보

아래는 이미지 오류가 아니라 UX 추가 후보다. 모두 넣기로 확정한 것은 아니다. 우선 상품을 구분하거나 선택하는 행을 대상으로 판단한다.

| 후보 | 구현 경로 | 사용할 기존 데이터 |
| --- | --- | --- |
| 구매자 리뷰 작성 대상 | shop/reviews/reviewable-list.tsx | ReviewableItem.thumbnailUrl |
| 구매자 내 문의 | shop/questions/my-questions-screen.tsx | MyQuestion.thumbnailUrl |
| 구매자 취소·반품 상품 선택 | shop/mypage/claim-request-screen.tsx | item.snapshot.thumbnailUrl |
| 판매자 상품 목록 | seller/products/product-list-workspace.tsx | SellerProductListItem.thumbnailUrl |
| 판매자 주문 목록 | seller/orders/order-list-workspace.tsx | SellerOrderListItem.thumbnailUrl |
| 판매자 주문 상세 상품 행 | seller/orders/order-detail-workspace.tsx | row.snapshot.thumbnailUrl |
| 판매자 클레임 목록 | seller/claims/claim-list-workspace.tsx | SellerClaimListItem.thumbnailUrl |
| 판매자 클레임 상세 상품 행 | seller/claims/claim-detail-workspace.tsx | row.snapshot.thumbnailUrl |
| 관리자 상품 목록 | admin/catalog/product-table.tsx | ProductSummary.thumbnailUrl |
| 관리자 클레임 상세·강제 처리 상품 행 | admin/claims/claim-detail-workspace.tsx, claim-force-dialog.tsx | row.snapshot.thumbnailUrl |
| 관리자 하자 반품 대상 선택 | admin/claims/defect-return-panel.tsx | item.snapshot.thumbnailUrl |

판매자 주문 인쇄(order-print-document.tsx)는 스냅샷이 있지만 인쇄 목적상 별도 판단한다. 관리자 주문 목록/상세는 주문·판매자 묶음·결제 단위 중심이므로 임의의 대표 상품을 추가하지 않는다. 구매자 주문 요약 역시 다상품 주문을 한 장으로 대표할 정책 없이 확대하지 않는다. 쿠폰 상품 선택은 텍스트 선택 UI이며 이번 오류 수정과 구분한다. 이 후보를 위해 상품별 상세 API를 추가 호출하는 N+1 방식은 피한다.

## 3. 상품 썸네일과 구분해야 하는 이미지

| 용도 | 경로 | 관찰 |
| --- | --- | --- |
| 리뷰 첨부 사진·리뷰 갤러리 작은 사진 | shop/reviews/review-card.tsx, product-reviews.tsx | null URL 처리 있음, 로드 실패 대체 없음 |
| 팔로잉·브랜드 페이지 로고 | shop/collections/following-screen.tsx, apps/shop/src/app/brands/[sellerId]/page.tsx | 상품 사진이 아닌 logoUrl 사용 |
| 관리자 판매자 심사 로고 | admin/sellers/seller-review-detail-workspace.tsx | logoUrl, null 분기만 있음 |
| 판매자 반품 증빙 | seller/claims/claim-detail-workspace.tsx | 상품 스냅샷과 다른 증빙 사진 URL, raw img |
| 구매자 리뷰·반품 업로드 | shop/uploads/photo-field.tsx | 파일명/상태만 표시. 미리보기 생략 이유가 코드에 명시되어 있음 |
| 관리자 반품 증빙 업로드 | admin/claims/return-photo-field.tsx | 파일명/상태만 표시 |
| 상품 공유 OG 이미지 | apps/shop/src/app/products/[id]/opengraph-image.tsx, lib/seo/og-image.ts | 원본 첫 이미지 URL을 서버 ImageResponse에 전달. 보정 우회, 클라이언트 onError 재사용 불가. 운영 실패는 별도 재현 필요 |
| 상품 JSON-LD | apps/shop/src/app/products/[id]/page.tsx | 원본 이미지 URL 배열. 화면 썸네일은 아니나 같은 오래된 URL 노출 가능 |
| 이미지 시안·업로드 데모 | apps/shop/src/app/image-preview/{page,coat-variants}.tsx, apps/seller/src/app/components/image-upload/ | 운영 상품 목록과 분리. 공통 UI 변경 시 회귀 확인 대상 |

리뷰·증빙·로고에는 상품 대체 이미지나 시드 상품 URL 매핑을 적용하지 않는다. 공통 저수준 오류 처리를 재사용하더라도 alt, object-fit, 안내, 업로드 상태는 용도별로 유지해야 한다. 증빙 사진 실패를 단순히 숨기면 심사자가 사진 부재와 로드 실패를 구분하지 못하므로 별도 정책이 필요하다.

## 4. 구조와 데이터 경로

- shop/products/product-thumbnail.tsx는 구매자 앱 내부 전용이다. packages/ui의 ProductCard, shop의 ProductGallery가 각각 별도 실패 상태와 대체 표시를 갖는다. 따라서 공통 컴포넌트가 없는 것이 아니라 공통 정책이 전체 소비자에 연결되어 있지 않다.
- shop/lib/products/seed-image-url.ts는 알려진 시드 102개 파일만 shop/public/seed/catalog의 동일 바이트 자산으로 연결한다. 판매자 앱에 상대 경로만 복사하면 판매자 origin에서 해당 파일을 찾게 되므로 해결되지 않는다.
- 상품 대표 이미지는 첫 번째 상품 이미지다. 카탈로그/판매자 목록, 장바구니, 컬렉션, 문의 API 및 검색 인덱스가 각각 thumbnailUrl로 투영한다. 주문 생성은 이를 snapshot으로 고정하고 판매자 주문/클레임/리뷰 작성 대상은 스냅샷을 사용한다.
- API 생성 근거: apps/api/src/catalog/{product,seller-product}.service.ts, cart/cart.service.ts, collections/collections.service.ts, questions/question.service.ts, search/{search-source,search-document}.ts, orders/{order-lines,seller-order-list.service}.ts, claims/seller-claim.service.ts, reviews/review.service.ts.
- 목적이 다른 현재 상품 이미지와 과거 주문 스냅샷을 하나의 최신 이미지 조회로 합치지 않는다. 통합할 것은 URL 해석·실패 처리·기본 렌더링 계약이며 데이터의 시간적 의미는 유지한다.

## 5. TASK 설계 제안

1. 상품 이미지 표시 정책 통합: 최근/찜 누락, 판매자 편집/미리보기, 공유 저수준 이미지 처리, 앱 간 시드 자산 경로를 함께 설계한다. 카드 최적화/갤러리 동작을 유지하고 UI 패키지 변경 시 Storybook 및 접근성 검사도 포함한다.
2. 상품 식별 행 썸네일 추가: 2절 후보 중 채택할 화면을 명시한다. 기존 응답 사용, 모바일 행 크기/밀도/키보드/라벨 검증, 추가 상세 조회 0건을 기준으로 둔다.
3. 리뷰·로고·증빙 오류 및 업로드 미리보기, OG/JSON-LD는 각각 목적과 서버/클라이언트 실행 환경이 달라 별도 후속 범위로 결정한다. 단순 img 전부 일괄 치환으로 처리하지 않는다.

공통 검증 행렬 후보: 정상 신규 업로드·알려진 시드·미등록 URL·null·공백·403/404·손상 응답·src 변경 후 복구, 로그인/비로그인 이력, 주문 스냅샷 불변, 세 앱 origin별 실제 디코딩, 360/768/1440px. 이번 조사는 코드 읽기와 문서 작성만 수행했으며 이 행렬의 새 구현/운영 검증 완료를 주장하지 않는다.
