# 주문서·주문 생성 왕복 축소 검증

기준 main `fec79271f713ae2e5359365830a791755e20cf3d`(TASK-0132 배포 포함). `feature/checkout-roundtrip-reduction`에서 비교했다. 동일한 실 PostgreSQL17·Nest HTTP·두 판매자/상품·DB 응답210ms 지연 조건이다. 준비 단계 비교는 측정 도중 클라이언트가 먼저 중단하지 않도록 테스트 HTTP 제한30초를 쓰고 별도로5초 미만을 단언한다. 운영 브라우저/서버 제한은 바꾸지 않았다.

| 단계 | 변경 전2개 | 변경 후2개 | 변경 후100개 |
| --- | --- | --- | --- |
| 주문서 생성 | 3,854ms / SQL28회 | 1,511ms / SQL7회 | 1,563ms / SQL7회 |
| 주문 생성 | 4,510ms / SQL29회 | 3,263ms / SQL18회 | 3,282ms / SQL18회 |

전부 HTTP201. 모든 주문PAID·구매 장바구니0까지 확인했다. 이것은 재현 표본이며 p95/운영 SLA가 아니다. 비교군에도 이미 TASK-0132 후처리 수정이 들어 있다.

원자료: [변경 전](artifacts/checkout-review/roundtrip-baseline.json), [두 상품](artifacts/checkout-review/roundtrip-two-items.json), [100상품](artifacts/checkout-review/roundtrip-hundred-items.json).

```bash
CHECKOUT_REMOTE_DIAGNOSTIC=1 CHECKOUT_REMOTE_PREPARATION=1 pnpm --filter @shopping/api exec vitest run test/api/checkout-remote-latency.diagnostic.spec.ts --maxWorkers=1
CHECKOUT_REMOTE_DIAGNOSTIC=1 CHECKOUT_REMOTE_PREPARATION=1 CHECKOUT_REMOTE_ITEMS=100 pnpm --filter @shopping/api exec vitest run test/api/checkout-remote-latency.diagnostic.spec.ts --maxWorkers=1
```

`CHECKOUT_REMOTE_PREPARATION`은 테스트 전용 지연 주입 스위치이며 배포 환경변수가 아니다. 변경 전 측정은 TASK-0131 worktree를 기준 main으로 맞추고 같은 진단 파일만 일시 적용한 뒤 원본으로 복원했다. 백엔드 DB를 모킹하지 않았다.

검증:

- 기존 장바구니·주문서·주문·멱등·후처리·성능105개 통과.
- 기존 Prisma select와 신규 SQL projection의 실제 결과 대조: UTC 삭제 시각, 옵션과 선택값, 대표 이미지 동점 정렬, 가격/정책/카테고리 동일. 빈/남의/없는 항목은 반환하지 않는다.
- 1/2/100개 각각 예약 INSERT1회, 판매자 주문/항목/초기 이력 INSERT 각각1회. 같은 주문 재시도/롤백·재고 대사도 함께 확인한다.
- 쿠폰·요율·예약·만료81개 회귀 통과. 전체 typecheck/lint/build/format 통과. API4,358개(진단2개 skip), shared103개, UI956개, api-mocks472개, admin1,164개, seller867개, shop1,259개(1개 skip) 통과. 배포·모바일 전체 구매는 결과 확인 뒤 기록한다.

TASK-0132 배포 뒤 확인한 [운영 앞 단계 응답 중단](2026-09-11-payment-finalization.md)을 해결하는 후속이다. 연결 획득 지연과 실제 cold start는 별도 원인이라 과대 해석하지 않는다.

## 운영 모바일 검증

PR141 배포 후 390px 실제 브라우저에서 두 상품 주문서 진입·새로고침·결제 완료·장바구니 비움 통과. 주문서 생성 Server-Timing total 2,182ms, 주문 생성3,439ms, 장바구니405ms/2SQL. 두 판매자 주문 모두 PAID, 썸네일 정상, 주문서401 없음. [원본 측정](artifacts/checkout-review/roundtrip-production-browser.json).

결제 버튼부터 완료까지26,475ms: 승인·확정 응답은 클라이언트5초에 중단되어 기존 결과 조회 복구를 거쳤다. 정상 서버 처리 도중의 조기 중단은 TASK0134에서 요청별 제한을 조정한다. 단회 warm 측정이며 p95나 cold 통계가 아니다.
