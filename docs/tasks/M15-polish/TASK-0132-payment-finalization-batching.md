# TASK-0132: 복수 상품 결제 후처리의 DB 왕복 축소

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M15 마무리 |
| 상태 | 완료 |
| 작성일 | 2026-09-11 |
| 브랜치 | `feature/payment-finalization-batching` |
| worktree | `feature-payment-finalization-batching` |
| 선행 작업 | TASK-0125, TASK-0127 (완료); TASK-0131 운영 trace/지연 재현 확보 |

## 1. 목적

상품 수에 비례한 결제 후처리 SQL 왕복으로 발생하는 transaction timeout을 줄이고, 매입된 결제의 주문·재고·장바구니 처리를 끝낸다. TASK-0131의 측정 결과를 구현으로 잇는다.

## 2. 범위

`OrderService.markPaid`, 예약 확정, 재고 원장, 판매자 주문 전이의 일괄 처리와 회귀 검증. 새 라우트·스키마·금액 정책·권한·인프라 변경은 없다. 장바구니/주문서 읽기 최적화와 실제 cold start 측정은 별도 후속으로 남긴다.

## 3. 요구사항

- 기존 Order 행 잠금과 하나의 후처리 transaction을 유지한다. 후처리 실패 시 전부 롤백하고 기존 PAID 복구 경로로 재실행한다.
- 원본 장바구니 id·소유자·수량·수정시각이 모두 같은 항목만 삭제한다.
- 재고 변경은 StockService, 주문 상태/이력 변경은 SellerOrderService를 통한다.
- 중복·동시 확정은 원장/이력을 한 번만 기록한다. 진행된 주문 상태를 되돌리지 않는다.

## 4. 설계

1. Order 잠금 시 필요한 스칼라 값도 읽는다. 장바구니 정리는 예약 스냅샷과 조인한 단일 DELETE로 수행한다.
2. ReservationService가 주문서 예약을 id 순으로 잠그고 상태를 다시 확인한다. CONFIRMED는 건너뛰고 RELEASED는 기존 단건 confirm과 같은 RESERVATION_RELEASED로 거절하며 HELD만 일괄 확정한다. 상태 필터로 잠금 대기 중 해제된 예약을 조용히 누락하지 않는다. StockService는 variant id 순으로 잠근 후 **다음 SQL의 새 스냅샷**에서 원장 seq를 읽는다. 같은 variant의 여러 예약은 각 원장 행에 연속 seq/balanceAfter를 남긴다.
3. StockService에서 reserved와 stock을 한 UPDATE로 갱신하고 원장은 createMany로 기록한다. 품절 전환 검색 outbox도 같은 transaction에서 일괄 기록한다. 예약은 updateMany로 CONFIRMED 처리한다.
4. SellerOrderService가 PAYMENT_PENDING 행들을 id 순으로 잠그고 기존 transitionDecision으로 각 전이를 검증한다. 상태/이력은 일괄 기록하고 이벤트는 커밋 뒤 발행한다.
5. 기본 transaction timeout을 늘리지 않는다. 지연 주입 조건에서 부족하면 원인을 다시 측정하고 문서를 먼저 갱신한다.

## 5. 구현 계획

문서 → 지연 재현을 성공 회귀로 전환 → 도메인별 일괄 처리 → 동시성·롤백·원장/장바구니 검사 → 전체 게이트 → PR/배포/소량 운영 구매 검증.

## 6. 완료 기준

| # | 기준 · 측정 방법 · 목표 | 충족 |
| --- | --- | --- |
| F1 | 실 PostgreSQL, DB 응답210ms 지연, 두 판매자 결제: HTTP201, 모든 주문 PAID, 구매 장바구니0, P2028 0건 | [x] |
| F2 | 1/2/100개 예약 후처리 SQL 횟수 상한20회, 상품 수에 따른 선형 증가 없음; 동일 지연에서 후처리 transaction5초 이내 | [x] |
| F3 | 동시/재시도 원장 및 상태 이력 중복0, 주입 실패 시 후처리 전체 롤백, 재실행 후 완료 | [x] |
| F4 | 동일 variant 여러 예약의 seq/balance 연속성·reserved/HELD 합계·stock/원장 대사 불일치0; 품절 outbox 생성 | [x] |
| F5 | 기존 장바구니 변경/재추가/다른 상품 보존 및 결제 복구·웹훅·예약 해제 회귀 통과 | [x] |
| F6 | 필수 CI typecheck/lint/build/test 및 E2E 통과, 배포 후 소량 두 상품 데모 구매 결과 기록 | [x] |

공통 [품질 게이트](../QUALITY-GATES.md) 적용. API 변경이므로 기존 UI 접근성/반응형 계약은 유지하며 구매 E2E로 연결을 검증한다. 문서/인덱스 두 곳 갱신, 측정 결과와 실행 조건 기록 후 완료한다.

## 7. 리스크 / 열린 질문

운영500의 원본 예외는 미확보이며 P2028은 격리 DB 재현 결과다. 210ms는 운영 trace에 근거한 주입 조건이지 운영 SLA가 아니다. 예약→variant 잠금 순서를 유지하고 다중 variant는 정렬한다. 실제 cold start는 TASK-0131 미완료 기준으로 남긴다.

## 8. 변경 이력

- 2026-09-11: 사용자의 기존 전체 수정/PR/배포 승인과 남은 결제 오류·지연 수정에 대한 “계속해봐” 지시에 따라 후속 구현을 분리. TASK-0131의 승인 범위를 임의로 확장하지 않고 별도 목적/검증 기준을 먼저 기록했다.

검증 근거: [후처리 측정·회귀 기록](../../reviews/2026-09-11-payment-finalization.md). 210ms 주입에서 두 상품/100상품 모두 HTTP201이며 후처리 transaction은 약3.2초다. 전체 capture는 약5.8초로 추가 조회 지연이 남아 있다.

PR #140 필수 CI4개·E2E5개·Lighthouse 통과 후 rebase 병합. Render 배포6375312018 성공(`fec7927`). 운영 서버 HTTP 구매에서 두 판매자 주문PAID·장바구니0 확인. 브라우저의 주문서 이동·주문 생성은 응답 중단이 남아 TASK-0133으로 분리했다. 전체 사용자 흐름 개선 완료를 뜻하지 않는다.
