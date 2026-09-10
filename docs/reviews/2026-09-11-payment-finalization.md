# 복수 상품 결제 후처리 검증

기준 main: `965fff746c1a0bdf9dddce0fc3c4098ee56e3a58`. TASK-0132 브랜치 `feature/payment-finalization-batching`에서 실 PostgreSQL17과 실제 Nest HTTP 경로로 검증했다. 환경은 TASK-0131과 동일한 격리된 로컬 DB이며, DB 응답 지연은 capture 동안 테스트 프로세스에만 주입했다. 서버/API 운영 예외를 직접 확인했다는 뜻은 아니다.

## 1. 지연 재현의 전후

| 구현 / 조건 | 상품·판매자 | capture | 후처리 transaction | 결과 |
| --- | --- | --- | --- | --- |
| 변경 전, 응답210ms 주입, 기본 제한5초 | 2 | 7,364.5ms / HTTP500 | P2028 | 결제PAID, 주문대기, 장바구니2 |
| 변경 후, 같은 지연/제한 | 2 | 5,788.2ms / HTTP201 | 3,207.8ms | 모두PAID, 장바구니0 |
| 변경 후, 같은 지연/제한 | 100 | 5,795.9ms / HTTP201 | 3,234.5ms | 모두PAID, 장바구니0 |

변경 전 정상 완료 비교군은 테스트 timeout만30초로 바꾼 결과9,012.7ms였다. 현재 코드는 기본5초를 유지한다. 운영 SLA나 p95가 아닌 단일 재현 표본이다. 전체 capture는 여전히 약5.8초이므로 사용자 대기가 모두 해결됐다고 볼 수 없다. transaction 밖의 결제 조회·응답 조립 등은 후속 최적화 대상이다.

원자료: [2개](artifacts/checkout-review/batched-db-delay-2-items.json), [100개](artifacts/checkout-review/batched-db-delay-100-items.json), [변경 전 조사](2026-09-10-checkout-latency-measurements.md). 전체 쿼리 수에는 커밋 뒤 비동기 알림이 포함될 수 있어 1회의 차이를 성능 개선으로 해석하지 않는다. SQL 회귀 기준은 별도 transaction 범위 검사다.

## 2. 재현 명령

```bash
CHECKOUT_REMOTE_DIAGNOSTIC=1 pnpm --filter @shopping/api exec vitest run test/api/checkout-remote-latency.diagnostic.spec.ts --maxWorkers=1
CHECKOUT_REMOTE_DIAGNOSTIC=1 CHECKOUT_REMOTE_ITEMS=100 pnpm --filter @shopping/api exec vitest run test/api/checkout-remote-latency.diagnostic.spec.ts --maxWorkers=1
pnpm --filter @shopping/api exec vitest run test/api/payment-finalization.spec.ts --maxWorkers=1
```

`CHECKOUT_REMOTE_ITEMS`는 기본2인 테스트 전용 표본 수다. 운영 설정이 아니다. 지연 진단은 일반 검사에서 skip하고 SQL 상한/정합성 검사는 CI에서도 실행한다.

## 3. 정합성·회귀

- 1/2/100개 각각 후처리 SQL20회 이하. Prisma query 이벤트의 Order 잠금부터 상태 이력 INSERT까지 세고, 이벤트에 없는 adapter BEGIN/COMMIT2회를 포함한다. 품절 검색 outbox 경로도 포함한다.
- 같은 주문의 동시 완료와 재시도: 예약당 원장1행, 판매자 주문당 PAID 이력1행.
- 상태 이력 INSERT 뒤 실패 주입: 장바구니/정리시각/예약/재고/원장/outbox/이력 전부 롤백, 재시도 후 완료.
- 같은 variant의 여러 예약: 원장 seq/balanceAfter 연속성, reserved와 HELD 합계 대사 통과.
- 잠금 대기 중 예약 해제: 잠금 획득 후 RELEASED를 거절하고 주문 대기/장바구니를 보존하며 재고 원장은 추가하지 않는다.
- 실제 다른 트랜잭션의 variant 잠금 대기를 확인한 뒤 입고/원장 추가: 잠금 해제 뒤 새 원장 seq를 읽어 다음 순번으로 확정.
- 기존 가상 카드·판매자 전이·예약·대사·웹훅·후처리 복구106개 통과. 기존 장바구니 보존 검사는 가상 카드 스위트에 포함한다.

## 4. 배포 검증

로컬 전체 typecheck/lint/build/format 검사 통과. API4,355개(진단2개 skip), shared103개, UI956개, api-mocks472개, admin1,164개, seller867개, shop1,259개(1개 skip) 통과. CI·배포 후 소량 운영 두 상품 구매 결과를 확인 후 추가한다. 실제 cold start와 운영500 원본 예외는 TASK-0131에서 미확보로 유지한다.

최종 예약 상태 재확인 코드의 별도8개 검사와100개 지연 재검사, 최종 서버 전체 검사 통과.

## 5. 운영 확인

PR #140: 필수4개 CI·E2E5개·Lighthouse 통과, main `fec79271f713ae2e5359365830a791755e20cf3d`. Render 배포6375312018이 2026-09-11 00:36 KST에 성공했다.

실제 운영 데모 구매자·서로 다른 판매자의 두 상품으로 HTTP 구매를 실행했다. capture HTTP201, 양쪽 판매자 주문PAID, 장바구니0. markPaid 서비스3,306ms, 전체 capture7,740ms(서버7,026ms, 연결 획득 누적2,556ms)였다. 원자료는 [운영 trace](artifacts/checkout-review/batched-payment-production.json). 중첩/병렬 span은 합산하지 않는다.

**브라우저 전체 흐름은 아직 완료되지 않았다.** 모바일 검증1회는 cart→checkout 이동을 마치지 못했고, 주문서를 실제 API로 생성해 분리한 두 번째 검증도 브라우저의 POST /orders 응답을 받지 못했다. 응답 대역/이미지 prefetch는 쓰지 않았다. 같은 운영 서버 HTTP 경로에서 주문서 생성4,962ms·주문 생성5,618ms를 확인했으며, 이 앞 단계는 TASK-0133에서 줄인다. 이번 API 구매 검증은 30초 HTTP 제한으로 완료 결과를 확인한 것이며, 5초 제한의 브라우저 전체 구매 성공으로 보고하지 않는다.
