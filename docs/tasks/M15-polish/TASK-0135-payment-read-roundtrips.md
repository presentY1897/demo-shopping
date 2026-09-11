# TASK-0135: 결제의 반복 조회 축소

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M15 마무리 |
| 상태 | 완료 |
| 작성일 | 2026-09-11 |
| 선행 | TASK0134 배포 및 TASK0131 구간 측정 |
| 브랜치 / worktree | `feature/payment-read-roundtrips` / `feature-payment-read-roundtrips` |

## 목적

실제 모바일 구매18.98초 중 서버 결제 생성2.42초·승인4.58초·확정5.62초였다. DB 왕복 약200ms 환경에서 결제의 불변 식별자 재조회 및 응답의 관계별 조회가 누적된다. 사용자 계속 진행 승인에 따라 측정 근거가 있는 조회를 축소한다.

## 설계

1. 소유권 조회에서 provider/orderId/methodRef를 함께 읽어 승인 직전 provider/context 조회를 제거한다. 승인 실행권 CAS 후 외부 provider를 호출하는 순서는 유지한다.
2. 사용자 capture가 소유권을 검사한 행을 내부 settle에 넘긴다. 배치 settle은 자체 read를 유지한다. 불변 orderId를 재사용하되 상태 판단을 위한 transaction 잠금·최신 행 재조회는 제거하지 않는다.
3. 결제 응답은 Payment/Order/User 및 정렬된 Refund를 대상 SQL projection으로 한 번에 읽는다. accountOwnershipSelect에 있는 필드만 owner projection으로 선택하고 기존 assertResourceAccess를 유지한다. refundedAt/id 정렬, UTC 날짜, NULL·없음·소유권 오류와 응답 계약을 기존 Prisma 경로와 비교한다. 원장/상태/transaction 경계는 그대로다.
4. 전역 Prisma 옵션·API 계약·15초 브라우저 마감·5초 transaction·배포 인프라/요금은 유지한다.

## 완료 기준

| # | 기준 | 충족 |
| --- | --- | --- |
| F1 | 실제 PostgreSQL에서 기존 응답 projection과 동등(환불 동률·UTC·NULL), 권한/데모 격리 회귀 통과 | [x] |
| F2 | 동일210ms DB 지연 조건에서 생성+승인+확정 총 SQL 최소8개 감소, 전체201·PAID·장바구니0 | [x] |
| F3 | 중복 승인·capture·재시도·대사·환불·rollback 회귀 통과, 잠금/실행권/CHARGE 유일성 유지 | [x] |
| F4 | 전체 typecheck/lint/format/build/test 및 정확한 head CI4개·E2E·Lighthouse 통과 | [x] |
| F5 | 운영 모바일 두 상품 구매/썸네일/새로고침/장바구니 비움 검증과 시간 기록 | [x] |

공통 품질 게이트 적용. 새 스키마·환경변수·라이브러리 없음. 단회 운영 측정은 p95나 인과 효과 전체를 증명하지 않는다. 실제 호스팅 scale-to-zero는 process-cold 측정과 분리한다.

검증: [동일 조건 SQL66→51·시간12.42→10.28초](../../reviews/2026-09-11-payment-read-latency.md), 기존 결제/대사/환불/최종화77개 및 새 SQL 횟수 검사 포함최종화9개 통과. F1의 전체 데모 격리는 전체 게이트에서도 확인한다.

## 완료 근거

PR144 head `5181dd0`의 전체 로컬 typecheck/lint/format/build/test와 CI4개·E2E·Lighthouse 완료·성공. API4362/shared103/UI956/mocks472/admin1164/seller867/shop1270 통과. Merge `16115e0`, API 운영 배포6387143952는2026-09-11 14:36 KST 성공.

14:37 KST 실제390px 브라우저에서 두 상품 cart→checkout→reload→payment→empty cart 성공. 화면에서 주문서/주문/결제를 생성했으며 장바구니·주문서 이미지 정상, 양쪽 PAID, 장바구니0, 결제 요청 실패0, 주문서401 없음. 클릭→완료17,320ms(이전18,976ms). 결제 응답 조회는각약205~222ms로 줄었으나 개별 DB 왕복약200ms는 유지됐다. [원자료](../../reviews/artifacts/checkout-review/payment-reads-production.json). 단회 비교라 전체 개선분의 인과 효과나 p95를 뜻하지 않는다.

사용자가 Neon Ohio를 확인하여 API Singapore와 리전을 맞추는 후속 TASK0136 초안을 작성했다. 운영 이전은 아직 실행하지 않았다.
