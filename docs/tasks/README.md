# Task 인덱스

전체 **107개** TASK. **M01 7개 + TASK-0014 · TASK-0015 · TASK-0020 · TASK-0105 완료**, 나머지 96개는 **승인 대기** 상태다.

| 마일스톤 | 범위 | 진행 |
| --- | --- | --- |
| [M01](./M01-foundation/) 기반 구축 | 워크스페이스, 공유 설정, 로컬 인프라, API/웹 부트스트랩, CI | **7/7 완료** |
| [M02](./M02-deployment/) 배포 파이프라인 | 도메인, Vercel×3, Railway, R2, 자동 배포, 관측, 콜드 스타트 | 0/7 |
| [M03](./M03-design-system/) 디자인 시스템 | 토큰·밀도 3단계, Radix 컴포넌트, 폼, 레이아웃, Storybook | 2/7 |
| [M04](./M04-auth/) 인증·계정 | Google OAuth, JWT, RBAC, 데모 발급·정리, 입점, 테스트 기반 | 2/11 |
| [M05](./M05-catalog/) 카탈로그 | 카테고리·속성 정의, 상품·SKU, 이미지, 재고 원장, 시드 | 0/10 |
| [M06](./M06-search/) 검색·탐색 | Meilisearch 인덱싱, 검색 API, 3단계 뷰, SEO, 한글 자동완성 | 0/9 |
| [M07](./M07-cart-order/) 장바구니·주문 | 장바구니, 금액 계산 엔진, 재고 예약, 주문 2단 분할 | 0/7 |
| [M08](./M08-payment/) 결제 | 프로바이더 추상화, 가상 카드, 토스 연동, 웹훅, 실패 복구 | 0/7 |
| [M09](./M09-fulfillment/) 배송·주문관리 | 상태 머신, 주문 화면, 가상 배송, 구매확정 | 0/6 |
| [M10](./M10-claims/) 취소·반품·환불 | 부분 취소·반품, 환불 안분, 재고 복원, 클레임 처리 | 0/7 |
| [M11](./M11-discount/) 할인 | 쿠폰(부담 주체), 적립금 원장, 적용·복구 | 0/7 |
| [M12](./M12-settlement/) 정산 | 수수료 정책, 정산서 배치, 승인·지급, 매출 대시보드 | 0/4 |
| [M13](./M13-community/) 회원 부가 | 리뷰, 위시리스트, Q&A, 팔로우, 알림, 신고 | 0/9 |
| [M14](./M14-admin/) 관리자 | 대시보드, 회원·판매자 관리, 전체 조회, 데모 관리 | 0/5 |
| [M15](./M15-polish/) 마무리 | 성능·정합성, 접근성, E2E·데모 시나리오, 포트폴리오 문서 | 0/4 |

---

<details><summary><b>M01. 기반 구축</b> (7/7 완료)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0001](./M01-foundation/TASK-0001-workspace-skeleton.md) | 워크스페이스 골격 | 완료 |
| [TASK-0002](./M01-foundation/TASK-0002-shared-config.md) | 공유 설정 패키지 | 완료 |
| [TASK-0003](./M01-foundation/TASK-0003-local-infra.md) | 로컬 인프라 (Docker) | 완료 |
| [TASK-0004](./M01-foundation/TASK-0004-api-bootstrap.md) | API 부트스트랩 | 완료 |
| [TASK-0005](./M01-foundation/TASK-0005-prisma-setup.md) | Prisma · DB 연결 | 완료 |
| [TASK-0006](./M01-foundation/TASK-0006-web-bootstrap.md) | 웹 앱 3종 부트스트랩 | 완료 |
| [TASK-0007](./M01-foundation/TASK-0007-dev-workflow.md) | 개발 워크플로 · CI | 완료 |

</details>

<details><summary><b>M02. 배포 파이프라인</b> (0/7)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0008](./M02-deployment/TASK-0008-domain-dns.md) | 도메인 확보 · DNS 구성 | 승인 대기 |
| [TASK-0009](./M02-deployment/TASK-0009-backend-deploy.md) | 백엔드 배포 (API · DB · 검색) | 승인 대기 |
| [TASK-0010](./M02-deployment/TASK-0010-frontend-deploy.md) | 프론트 배포 (Vercel × 3) | 승인 대기 |
| [TASK-0011](./M02-deployment/TASK-0011-object-storage.md) | 오브젝트 스토리지 (R2) | 승인 대기 |
| [TASK-0012](./M02-deployment/TASK-0012-cd-pipeline.md) | 배포 자동화 · 환경변수 관리 | 승인 대기 |
| [TASK-0013](./M02-deployment/TASK-0013-observability.md) | 로그 · 에러 추적 · 모니터링 | 승인 대기 |
| [TASK-0101](./M02-deployment/TASK-0101-cold-start.md) | 콜드 스타트 대응 · 서버 웨이크업 UX | 승인 대기 |

</details>

<details><summary><b>M03. 디자인 시스템</b> (2/7)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0014](./M03-design-system/TASK-0014-design-tokens.md) | 디자인 토큰 · 밀도 3단계 | 완료 |
| [TASK-0015](./M03-design-system/TASK-0015-base-components.md) | 기본 컴포넌트 | 완료 |
| [TASK-0016](./M03-design-system/TASK-0016-data-components.md) | 데이터 표시 컴포넌트 | 승인 대기 |
| [TASK-0017](./M03-design-system/TASK-0017-form-system.md) | 폼 시스템 | 승인 대기 |
| [TASK-0018](./M03-design-system/TASK-0018-shop-layout.md) | shop 레이아웃 · 밀도 토글 | 승인 대기 |
| [TASK-0019](./M03-design-system/TASK-0019-console-layout.md) | 콘솔 레이아웃 (seller · admin) | 승인 대기 |
| [TASK-0104](./M03-design-system/TASK-0104-storybook.md) | Storybook | 승인 대기 |

</details>

<details><summary><b>M04. 인증·계정</b> (2/11)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0020](./M04-auth/TASK-0020-user-schema.md) | 사용자 · 역할 스키마 | 완료 |
| [TASK-0021](./M04-auth/TASK-0021-google-oauth.md) | Google OAuth 로그인 | 승인 대기 |
| [TASK-0022](./M04-auth/TASK-0022-jwt-session.md) | JWT 발급 · 갱신 · 로그아웃 | 승인 대기 |
| [TASK-0023](./M04-auth/TASK-0023-auth-guard.md) | 인증 UI · 권한 가드 | 승인 대기 |
| [TASK-0024](./M04-auth/TASK-0024-demo-account.md) | 데모 계정 발급 | 승인 대기 |
| [TASK-0025](./M04-auth/TASK-0025-demo-cleanup.md) | 데모 만료 · 정리 스케줄러 | 승인 대기 |
| [TASK-0026](./M04-auth/TASK-0026-seller-onboarding.md) | 판매자 입점 신청 · 승인 | 승인 대기 |
| [TASK-0027](./M04-auth/TASK-0027-profile-address.md) | 프로필 · 배송지 관리 | 승인 대기 |
| [TASK-0105](./M04-auth/TASK-0105-rbac.md) | 퍼미션 기반 권한 체계 (RBAC) | 완료 |
| [TASK-0106](./M04-auth/TASK-0106-backend-test-infra.md) | 백엔드 통합 테스트 기반 | 승인 대기 |
| [TASK-0107](./M04-auth/TASK-0107-frontend-api-mocking.md) | 프론트 API 모킹 · 계약 고정 | 승인 대기 |

</details>

<details><summary><b>M05. 카탈로그</b> (0/10)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0028](./M05-catalog/TASK-0028-category-schema.md) | 카테고리 스키마 · 트리 API | 승인 대기 |
| [TASK-0029](./M05-catalog/TASK-0029-category-admin.md) | 관리자 카테고리 관리 화면 | 승인 대기 |
| [TASK-0030](./M05-catalog/TASK-0030-attribute-schema.md) | 속성 정의 스키마 · API | 승인 대기 |
| [TASK-0031](./M05-catalog/TASK-0031-attribute-admin.md) | 관리자 속성 관리 화면 | 승인 대기 |
| [TASK-0032](./M05-catalog/TASK-0032-product-schema.md) | 상품 · 옵션 · Variant 스키마 | 승인 대기 |
| [TASK-0033](./M05-catalog/TASK-0033-image-upload.md) | 이미지 업로드 위젯 | 승인 대기 |
| [TASK-0034](./M05-catalog/TASK-0034-product-editor.md) | 판매자 상품 등록 · 수정 | 승인 대기 |
| [TASK-0035](./M05-catalog/TASK-0035-product-list-seller.md) | 판매자 상품 목록 · 재고 관리 | 승인 대기 |
| [TASK-0036](./M05-catalog/TASK-0036-stock-ledger.md) | 재고 원장 | 승인 대기 |
| [TASK-0037](./M05-catalog/TASK-0037-seed-data.md) | 시드 데이터 생성기 | 승인 대기 |

</details>

<details><summary><b>M06. 검색·탐색</b> (0/9)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0038](./M06-search/TASK-0038-search-indexing.md) | Meilisearch 인덱스 · 동기화 파이프라인 | 승인 대기 |
| [TASK-0039](./M06-search/TASK-0039-search-api.md) | 검색 API (필터 · 정렬 · 패싯) | 승인 대기 |
| [TASK-0040](./M06-search/TASK-0040-product-card.md) | 상품 카드 · 목록 (밀도 3단계) | 승인 대기 |
| [TASK-0041](./M06-search/TASK-0041-search-page.md) | 검색 페이지 · 자동완성 · 필터 | 승인 대기 |
| [TASK-0042](./M06-search/TASK-0042-category-page.md) | 카테고리 페이지 | 승인 대기 |
| [TASK-0043](./M06-search/TASK-0043-product-detail.md) | 상품 상세 (밀도 3단계) | 승인 대기 |
| [TASK-0044](./M06-search/TASK-0044-home-brand.md) | 홈 · 브랜드관 | 승인 대기 |
| [TASK-0102](./M06-search/TASK-0102-seo.md) | SEO | 승인 대기 |
| [TASK-0103](./M06-search/TASK-0103-hangul-autocomplete.md) | 한글 자모 · 초성 자동완성 | 승인 대기 |

</details>

<details><summary><b>M07. 장바구니·주문</b> (0/7)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0045](./M07-cart-order/TASK-0045-cart-api.md) | 장바구니 스키마 · API | 승인 대기 |
| [TASK-0046](./M07-cart-order/TASK-0046-cart-page.md) | 장바구니 화면 (판매자별 그룹) | 승인 대기 |
| [TASK-0047](./M07-cart-order/TASK-0047-pricing-engine.md) | 금액 계산 엔진 | 승인 대기 |
| [TASK-0048](./M07-cart-order/TASK-0048-stock-reservation.md) | 재고 예약 | 승인 대기 |
| [TASK-0049](./M07-cart-order/TASK-0049-order-create.md) | 주문 생성 API (2단 분할) | 승인 대기 |
| [TASK-0050](./M07-cart-order/TASK-0050-checkout-page.md) | 주문서 화면 | 승인 대기 |
| [TASK-0051](./M07-cart-order/TASK-0051-reservation-expiry.md) | 예약 만료 스케줄러 | 승인 대기 |

</details>

<details><summary><b>M08. 결제</b> (0/7)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0052](./M08-payment/TASK-0052-payment-abstraction.md) | PaymentProvider 추상화 · 결제 스키마 | 승인 대기 |
| [TASK-0053](./M08-payment/TASK-0053-virtual-card.md) | 가상 카드 발급 · 원장 | 승인 대기 |
| [TASK-0054](./M08-payment/TASK-0054-virtual-card-payment.md) | 가상 카드 결제 · 실패 재현 | 승인 대기 |
| [TASK-0055](./M08-payment/TASK-0055-toss-integration.md) | 토스페이먼츠 연동 | 승인 대기 |
| [TASK-0056](./M08-payment/TASK-0056-payment-webhook.md) | 결제 웹훅 (멱등 처리) | 승인 대기 |
| [TASK-0057](./M08-payment/TASK-0057-payment-failure.md) | 결제 실패 · 복구 처리 | 승인 대기 |
| [TASK-0058](./M08-payment/TASK-0058-card-management.md) | 가상 카드 관리 화면 | 승인 대기 |

</details>

<details><summary><b>M09. 배송·주문관리</b> (0/6)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0059](./M09-fulfillment/TASK-0059-order-state-machine.md) | 주문 상태 머신 구현 | 승인 대기 |
| [TASK-0060](./M09-fulfillment/TASK-0060-seller-orders.md) | 판매자 주문 관리 화면 | 승인 대기 |
| [TASK-0061](./M09-fulfillment/TASK-0061-shipment.md) | 배송 · 운송장 가상 처리 | 승인 대기 |
| [TASK-0062](./M09-fulfillment/TASK-0062-delivery-simulator.md) | 배송 상태 자동 진행 시뮬레이터 | 승인 대기 |
| [TASK-0063](./M09-fulfillment/TASK-0063-buyer-orders.md) | 구매자 주문 내역 · 상세 | 승인 대기 |
| [TASK-0064](./M09-fulfillment/TASK-0064-order-confirm.md) | 구매확정 (수동 · 자동) | 승인 대기 |

</details>

<details><summary><b>M10. 취소·반품·환불</b> (0/7)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0065](./M10-claims/TASK-0065-claim-schema.md) | 클레임 스키마 · 상태 머신 | 승인 대기 |
| [TASK-0066](./M10-claims/TASK-0066-cancel-flow.md) | 취소 신청 · 처리 (부분) | 승인 대기 |
| [TASK-0067](./M10-claims/TASK-0067-return-flow.md) | 반품 신청 · 수거 · 검수 (부분) | 승인 대기 |
| [TASK-0068](./M10-claims/TASK-0068-refund-calc.md) | 환불 안분 계산 · 실행 | 승인 대기 |
| [TASK-0069](./M10-claims/TASK-0069-stock-restore.md) | 재고 복원 | 승인 대기 |
| [TASK-0070](./M10-claims/TASK-0070-seller-claims.md) | 판매자 클레임 처리 화면 | 승인 대기 |
| [TASK-0071](./M10-claims/TASK-0071-admin-claims.md) | 관리자 클레임 개입 | 승인 대기 |

</details>

<details><summary><b>M11. 할인</b> (0/7)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0072](./M11-discount/TASK-0072-coupon-schema.md) | 쿠폰 스키마 · 발행 API | 승인 대기 |
| [TASK-0073](./M11-discount/TASK-0073-platform-coupon-admin.md) | 관리자 플랫폼 쿠폰 화면 | 승인 대기 |
| [TASK-0074](./M11-discount/TASK-0074-seller-coupon.md) | 판매자 쿠폰 화면 | 승인 대기 |
| [TASK-0075](./M11-discount/TASK-0075-coupon-apply.md) | 쿠폰 적용 · 검증 | 승인 대기 |
| [TASK-0076](./M11-discount/TASK-0076-point-ledger.md) | 적립금 원장 · 적립 · 사용 | 승인 대기 |
| [TASK-0077](./M11-discount/TASK-0077-coupon-point-pages.md) | 쿠폰함 · 적립금 내역 화면 | 승인 대기 |
| [TASK-0078](./M11-discount/TASK-0078-discount-restore.md) | 환불 시 쿠폰 · 적립금 복구 | 승인 대기 |

</details>

<details><summary><b>M12. 정산</b> (0/4)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0079](./M12-settlement/TASK-0079-commission.md) | 수수료 정책 · 관리자 설정 | 승인 대기 |
| [TASK-0080](./M12-settlement/TASK-0080-settlement-batch.md) | 정산서 생성 배치 | 승인 대기 |
| [TASK-0081](./M12-settlement/TASK-0081-settlement-admin.md) | 관리자 정산 승인 · 지급 | 승인 대기 |
| [TASK-0082](./M12-settlement/TASK-0082-seller-settlement.md) | 판매자 정산 내역 · 매출 대시보드 | 승인 대기 |

</details>

<details><summary><b>M13. 회원 부가</b> (0/9)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0083](./M13-community/TASK-0083-review-write.md) | 리뷰 스키마 · 작성 (구매 검증) | 승인 대기 |
| [TASK-0084](./M13-community/TASK-0084-review-display.md) | 리뷰 표시 · 평점 집계 | 승인 대기 |
| [TASK-0085](./M13-community/TASK-0085-review-reply.md) | 판매자 리뷰 답변 | 승인 대기 |
| [TASK-0086](./M13-community/TASK-0086-wishlist.md) | 위시리스트 | 승인 대기 |
| [TASK-0087](./M13-community/TASK-0087-recently-viewed.md) | 최근 본 상품 | 승인 대기 |
| [TASK-0088](./M13-community/TASK-0088-product-qna.md) | 상품 Q&A | 승인 대기 |
| [TASK-0089](./M13-community/TASK-0089-seller-follow.md) | 판매자 팔로우 | 승인 대기 |
| [TASK-0090](./M13-community/TASK-0090-notification.md) | 알림 시스템 | 승인 대기 |
| [TASK-0091](./M13-community/TASK-0091-report.md) | 신고 처리 | 승인 대기 |

</details>

<details><summary><b>M14. 관리자</b> (0/5)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0092](./M14-admin/TASK-0092-admin-dashboard.md) | 관리자 대시보드 | 승인 대기 |
| [TASK-0093](./M14-admin/TASK-0093-user-management.md) | 회원 관리 | 승인 대기 |
| [TASK-0094](./M14-admin/TASK-0094-seller-management.md) | 판매자 관리 | 승인 대기 |
| [TASK-0095](./M14-admin/TASK-0095-global-catalog-orders.md) | 전체 상품 · 주문 조회 | 승인 대기 |
| [TASK-0096](./M14-admin/TASK-0096-demo-management.md) | 데모 계정 관리 | 승인 대기 |

</details>

<details><summary><b>M15. 마무리</b> (0/4)</summary>

| ID | 제목 | 상태 |
| --- | --- | --- |
| [TASK-0097](./M15-polish/TASK-0097-performance.md) | 성능 최적화 · 측정 | 승인 대기 |
| [TASK-0098](./M15-polish/TASK-0098-accessibility.md) | 접근성 점검 | 승인 대기 |
| [TASK-0099](./M15-polish/TASK-0099-e2e-demo.md) | E2E 테스트 · 데모 시나리오 | 승인 대기 |
| [TASK-0100](./M15-polish/TASK-0100-portfolio-docs.md) | README · 포트폴리오 문서 | 승인 대기 |

</details>

---

## 진행 순서

**마일스톤 번호는 진행 순서가 아니다.** M01→M15 는 주제별 묶음이고, 각 TASK 의 `선행` 이 실제 의존이다. 마일스톤 표에 적힌 `선행 M0N 완료` 는 문서를 쓸 때의 관례였을 뿐, 기술적 의존이 아닌 경우가 많다.

예를 들어 TASK-0014(디자인 토큰)의 선행은 M02(배포)로 적혀 있었지만 토큰은 CSS 변수라 배포와 무관하고, TASK-0020(사용자 스키마)의 선행은 M03(디자인 시스템)이었지만 스키마 정의에 컴포넌트가 필요하지 않다. 둘 다 **M01 만 있으면 된다.**

그래서 **마일스톤을 가로질러 병행**한다. M02 는 외부 서비스 계정 준비를 기다리는 중이므로, 그동안 M03·M04·M05 의 선행 없는 TASK 를 먼저 진행한다.

### 병행 규칙

| # | 규칙 | 이유 |
| --- | --- | --- |
| 1 | **`schema.prisma` 를 건드리는 TASK 는 동시에 하나만** | 두 브랜치가 각자 마이그레이션 폴더를 만들면 타임스탬프 순서가 꼬이고, rebase 로는 정리되지 않는다 |
| 2 | 웨이브 안에서 **파일 소유권을 미리 가른다** | 같은 파일을 두 곳에서 고치면 rebase 충돌이 확정이다. `pnpm-lock.yaml` 은 예외 — 충돌이 예정된 지점이라 머지 순서로 처리한다 |
| 3 | **인덱스 2곳은 머지하는 쪽이 갱신한다** | 두 에이전트가 같은 진행률 줄을 고치면 반드시 충돌한다 |
| 4 | PR 머지는 **순차적** | 보호 규칙의 `strict` 때문에 하나를 머지하면 나머지는 `main` 기준으로 다시 rebase·push 해야 한다 |

## 규칙

- **한 TASK = 하나의 작업 목적.** 여러 목적이 섞이면 쪼갠다.
- 번호는 **전역 4자리 평면 번호**다. 마일스톤이 바뀌어 파일을 옮겨도 번호는 유지한다.
- 디렉터리는 그룹핑만 담당한다. `TASK-0042` 라는 참조는 위치와 무관하게 유효하다.
- **삭제된 번호는 재사용하지 않는다.** 결번은 그대로 둔다.
- 모든 TASK 문서는 [`TASK-TEMPLATE.md`](./TASK-TEMPLATE.md) 를 복사해 작성한다.
- 품질 게이트는 [`QUALITY-GATES.md`](./QUALITY-GATES.md) 를 참조하고 **예외만** 각 TASK 에 적는다.
- **6장 완료 기준은 필수**이며 각 항목은 측정 방법과 목표값을 가져야 한다.
- 완료 기준을 전부 충족하기 전에는 상태를 `완료` 로 바꾸지 않는다.
- 완료된 마일스톤은 이 문서에서 `<details>` 로 접는다.

### 구현 중 설계 변경이 필요할 때

```
문제 발견 → 해당 작업 중단 → 설계 문서(design/ · DECISIONS.md) 수정
          → 영향받는 TASK 문서 수정 → 사용자 승인 → 재개
```

**코드를 먼저 고치고 문서를 나중에 맞추지 않는다.** 문서가 실제와 어긋나기 시작하면 이 체계 전체가 무의미해진다.

상태: `초안` → `승인 대기` → `승인됨` → `진행중` → `완료` / `보류` / `폐기`
