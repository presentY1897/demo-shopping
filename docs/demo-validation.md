# 세 역할 거래 검증

검증 대상은 같은 상품·주문을 서로 독립된 구매자/판매자/관리자 세션에서 처리하는 흐름이다. 일반 방문자는 상점 `/guide`의 순서대로 판매자 계정을 먼저 만들고, 그 스토어의 상품을 구매한다. 역할별 초기 주문은 서로 다른 방문자의 계정과 자동 연결되지 않는다.

## 실제 브라우저 흐름

`e2e/tests`의 기존4개 파일(5개 검사)을 유지한다. `purchase`는 키보드 구매, `density`는 넓은/좁은 화면 밀도 변경을 검사한다. `seller`는 UI 상품 등록→구매자 검색 링크 클릭→장바구니·결제→관리자 주문번호 검색→판매자 확인·발송→세 역할 운송장 대조→관리자 숨김·복구→검색 제외·재노출과 기존 주문 보존을 검사한다. `refund`는 초기 복제 상품2개 검색·구매→발송 전 부분 취소→나머지 배송완료→반품 신청→판매자 거절→관리자 개입→회수·입고·검수→환불·주문 종료를 검사한다.

주문번호/금액/상태/운송장은 화면에서 확인한다. 관리자 요약 화면에 없는 SKU·수량은 해당 관리자 세션의 인증된 주문 상세 GET 응답을 공유 스키마로 파싱하여 결제 당시 응답과 비교한다. 이 읽기를 UI 버튼 검증으로 표현하지 않는다. 비공개 상품의 신규 장바구니 추가 거부와 원장 대사는 아래 API 검사가 담당한다.

발급 수는 한 회당 구매1+판매3+환불3=7개다. 기존5회/60초 서버 한도를 유지하며, 성공 발급의 서버 Date 시각만 임시 파일에 기록하고 HEAD health의 서버 시각과 비교해 다음 발급 가능 시점까지 기다린다. 파일은 토큰·계정 정보를 담지 않고 반복 worker 사이에서도 예산을 유지한다. CI의 재시도1회는 기존 설정이며 안정성 판정은 `--retries=0 --repeat-each=3`로 한다. 고정 sleep, 강제 클릭, API로 UI 쓰기 우회, DB 상태 조작은 사용하지 않는다.

## 실제 API·DB 검사 연결

| 대상 | 검사 파일 (`apps/api/test/api/`) | 확인하는 결과 |
| --- | --- | --- |
| 검색·관리자 조치·만료 | `search-indexing.integration.spec.ts` | 원본12개 복제의 검색 수렴, 실제 세션 구매/관리자 숨김·복원, Clock25시간 진행과 정리 후 해당 스토어 색인0건 |
| 비공개 권한·신규 구매 거부 | `demo-product-visibility.spec.ts` | 데모 관리자의 데모 비공개 목록/상세 조회, 실계정 비공개404, 구매자 비공개404, 숨김 상품 장바구니400 |
| 결제 실패·중복·복구 | `payments.integration.spec.ts`, `virtual-card-payment.spec.ts`, `payment-finalization.spec.ts`, `payment-reconcile.spec.ts`, `payment-webhook.spec.ts` | 승인·원장의 멱등성, 중복 확정/콜백, 실패와 결과 복구 |
| 재고·품절·예약 | `reservation.integration.spec.ts`, `reservation-expiry.spec.ts`, `checkouts.integration.spec.ts` | 동시 예약의 초과 판매 방지, 품절 거부, 만료 예약 해제 |
| 부분 환불·원장 | `refund.spec.ts`, `return-flow.spec.ts`, `claim-cancel.spec.ts` | 실제 안분/카드/재고 환불, 중복·실패 환불, 확정 취소 후 잔여 전량 반품의 RETURNED 전이 |
| 관리자 범위 | `admin-claim.spec.ts`, `demo-trade-fixtures.integration.spec.ts` | 타인·실계정 쓰기 거부, 데모 클레임 개입, 데모 정산 승인 범위와 지급 거부 |
| 만료 정리 | `demo-cleanup.integration.spec.ts`, `demo-trade-fixtures.integration.spec.ts` | 보조 계정 포함 만료, FK·예약·원장 보존과 공용 카탈로그 격리 |

## 실행·증거

로컬/CI는 실제 PostgreSQL·Meilisearch와 세 앱의 운영 빌드를 사용한다. 실행 명령은 `pnpm --filter @shopping/e2e exec playwright test --repeat-each=3 --retries=0`이다. 한 회 실행 예산은10분이다. API 테스트 DB와 브라우저용 DB/색인을 분리하여 테스트 초기화가 열린 브라우저의 데이터를 지우지 않게 한다.

운영은 `E2E_SHOP_URL`, `E2E_SELLER_URL`, `E2E_ADMIN_URL`, `E2E_API_URL`을 명시하고 새 데모 판매자 상품을 사용하는 `seller.spec.ts`와 `refund.spec.ts`를 실행한다. 강제 실패·시간 진행·반복 부하는 운영에서 실행하지 않는다. 운영 결과와 정확한 커밋/시각은 TASK0140/0141에 남긴다.

실패 시 trace/스크린샷을 남긴다. 업로드 전에 인증 헤더·쿠키·중첩 응답 토큰을 제거하며 제거 검사 실패 시 artifact 업로드도 차단한다. 바이너리 이미지와 주문번호·상태는 보존한다. 운영 계정 세션과 DB 조회 원문은 공개 저장소에 넣지 않는다.
