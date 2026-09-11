# 결제 잔여 지연과 실제 프로세스 기동 측정 — 2026-09-11

## 범위와 결과

기준 구현 `e8114f7`(측정 시 문서 커밋 `8d46efe`), PostgreSQL17 로컬5612·Meilisearch7870. 최신 warm 표본은 동일 코드·데이터의 동시성1 30회/동시성4 32회이며 기존 opt-in diagnostic을 그대로 실행했다. JWT가 제외된 테스트 header principal 측정이다. 아래 process-cold는 실제 production build/JWT 경로다. 둘을 같은 모집단으로 합치지 않는다.

| 동시성 | 요청 | n | 중앙값ms | p95ms | 최대ms | 오류 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | cart.add | 30 | 12.6 | 14.87 | 24.44 | 0 |
| 1 | cart.get | 30 | 3.96 | 4.54 | 5.62 | 0 |
| 1 | checkout.open | 30 | 10.16 | 11.14 | 14.41 | 0 |
| 1 | order.create | 30 | 16.27 | 25.6 | 35.16 | 0 |
| 1 | payment.authorize | 30 | 20.19 | 22.92 | 28.58 | 0 |
| 1 | payment.capture | 30 | 24.91 | 28.75 | 41.67 | 0 |
| 1 | payment.start | 30 | 11.16 | 14.45 | 15.8 | 0 |
| 4 | cart.add | 32 | 16.27 | 21.69 | 23.72 | 0 |
| 4 | cart.get | 32 | 3.5 | 4.62 | 12.56 | 0 |
| 4 | checkout.open | 32 | 15.99 | 23.55 | 26.83 | 0 |
| 4 | order.create | 32 | 20.37 | 27.63 | 37.17 | 0 |
| 4 | payment.authorize | 32 | 24.49 | 31.13 | 32.28 | 0 |
| 4 | payment.capture | 32 | 35.13 | 46.49 | 48.79 | 0 |
| 4 | payment.start | 32 | 13.15 | 20.05 | 20.06 | 0 |

## 최초 기동과 정상 실행 분리

`scripts/measure-checkout-startup.cjs`는 새 JWT 비밀값을 메모리에 만들고, 전용 로컬 DB에서 데모 구매자 하나를 발급한 뒤 서버 프로세스를30회 종료·재시작한다. TCP listen을 확인한 직후 첫 인증 GET/cart, 다음 GET/cart를 잰다. 프로세스/DB pool은 새것이고 PostgreSQL/검색 컨테이너·OS 캐시는 유지한다. TCP 확인은100ms 제한+10ms 재시도라 기동 값에 최대 약110ms의 탐지 오차가 있다. 포트4181이 사용 중이면 중단한다.

| 구간 | n | 중앙값ms | p95ms | 최대ms | 오류 |
| --- | --- | --- | --- | --- | --- |
| 프로세스 시작→listen 감지 | 30 | 642.86 | 795.03 | 814.94 | 0 |
| 첫 JWT 장바구니 요청 | 30 | 74.80 | 91.25 | 101.13 | 0 |
| 직후 JWT 장바구니 요청 | 30 | 7.75 | 23.83 | 39.17 | 0 |

실행: `pnpm --filter @shopping/api run build` 후 저장소 루트에서 `node scripts/measure-checkout-startup.cjs`. 로컬5612 PostgreSQL(시드 완료),7870 Meilisearch가 필요하다. 결과는 `/tmp/checkout-process-cold.json`, 토큰/쿠키/주소/SQL은 결과에 쓰지 않는다.

운영 최초 health 관측은 HTTP200, uptime47,040초였고 응답1,291/1,301/1,761ms였다. 이미13시간 넘게 실행 중이므로 **호스팅 cold 표본이 아니다**. Render/Neon의 scale-to-zero 재기동은 확보하지 못했으며 운영을 중단해 만들지 않았다. 로컬 process-cold로 그 값을 대신하지 않는다.

## 반복 조회와 TASK0135

권한을 확인한 결제의 provider/orderId/methodRef를 다시 읽는 경로와 응답의 Payment→Refund/Order→User 개별 조회를 찾았다. 상태 판단을 위한 잠금/최신 조회는 필요하고, 불변 식별자의 반복 조회는 제거할 수 있다. Payment 응답은 단일 projection으로 읽어 권한 검사와 환불 정렬·UTC·NULL을 보존한다.

격리 실 PostgreSQL의 query 응답마다210ms를 넣어 동일2상품을 비교했다. API transaction5초와 HTTP30초 진단 예산은 양쪽 동일하며 운영 설정을 바꾸지 않는다.

| 단계 | 이전ms | 수정ms | 이전SQL | 수정SQL |
| --- | --- | --- | --- | --- |
| 결제 생성 | 2570.04 | 2141.14 | 13 | 10 |
| 승인 | 4076.43 | 3209.13 | 20 | 15 |
| 확정 | 5773.47 | 4925.79 | 33 | 26 |
| 합계 | 12419.94 | 10276.07 | 66 | 51 |

두 경우 모두201/PAID, 판매자 둘 PAID, 장바구니0, transaction 오류0. SQL 시간은 병렬·상위 구간과 중첩되므로 누적 시간을 단순 합산하지 않는다. 로컬 지연 모형은 운영 p95가 아니다. 남은 원장/상태/예약 처리는 필수이므로 추가 감소는 정합성 근거가 필요하다.

Render 선언은Singapore이나 운영 DB 리전은 확인하지 못했다. 지역 불일치는 아직 가설이다. 지역명 확인과 같은 환경의 실제 RTT 비교 없이 인프라 이전·풀 확대·유료 플랜을 제안하지 않는다.

## 원자료

[최신 warm](artifacts/checkout-review/api-latency-current.json), [warm 집계](artifacts/checkout-review/api-latency-current-summary.json), [process-cold30](artifacts/checkout-review/api-process-cold.json), [운영 첫 health](artifacts/checkout-review/api-first-health-current.json), [개선 전](artifacts/checkout-review/payment-reads-before.json), [개선 후](artifacts/checkout-review/payment-reads-after.json).
