# 기술적 의사결정

이 문서는 멀티 셀러 거래를 구현하면서 선택한 여섯 가지 설계를 설명한다. 구현 대조 기준은
`main`의 `3bb9fdc`다. 아래 테스트 링크는 검증 내용을 확인할 수 있는 소스이며, 현재 브랜치에서
모든 테스트를 다시 통과했다는 뜻은 아니다. 이번 실행 결과는 [초안 점검표](./portfolio-status.md)에 기록한다.

## 1. 주문을 결제 단위와 판매자 단위로 나눈 이유

### 문제와 대안

한 번의 결제로 여러 판매자의 상품을 사도 발송·취소·배송비·정산은 판매자마다 다르다.
주문에 상태를 하나만 두면 한 판매자는 배송중이고 다른 판매자는 취소된 상황을 표현하기 어렵다.
판매자별 주문만 만들고 결제를 연결하는 방법도 가능하지만, 통합 결제 단위를 따로 정의해야 한다.

### 선택과 결과

`Order`에 주문번호·수령인·결제 금액을 두고, `SellerOrder`에 판매자별 상태와 배송비를 둔다.
`OrderItem`에는 상품명·옵션·단가·할인 안분액 등 주문 당시 값을 저장한다.

판매자는 자기 몫만 발송하고, 구매자는 한 주문 안에서 판매자별 진행을 본다. 정산은
SellerOrder를 참조하는 항목으로 집계하며, 이후 반품은 정산 상태에 따라 반영 방식이 달라진다.
현재 상품 정보가 바뀌어도 과거 거래 금액과 상품 설명을 유지할 수 있다.

**대가:** 한 주문의 완료 여부를 여러 판매자 상태에서 해석해야 한다. 화면·클레임·정산에
공통 식별자와 상태 전이 규칙이 필요하다. SellerOrder 하나가 언제나 정산 항목 하나와
일대일인 것은 아니다. 반품 조정 항목이 추가될 수 있다.

- 구현: [주문 서비스](../apps/api/src/orders/order.service.ts), [정산 배치](../apps/api/src/settlement/settlement-batch.service.ts)
- 검증: [주문 통합](../apps/api/test/api/orders.integration.spec.ts), [판매자 상태 전이](../apps/api/test/api/seller-order-transition.spec.ts), [정산 여정](../apps/api/test/api/settlement-journey.spec.ts)
- 규칙: [ERD](./design/erd.md), [상태 전이](./design/state-machines.md)

## 2. 속성 정의는 테이블, 상품 값은 JSONB로 둔 이유

### 문제와 대안

카테고리마다 필수 정보가 다르고 운영자가 속성을 추가할 수 있어야 한다. 고정 컬럼은
추가할 때마다 마이그레이션이 필요하다. EAV는 속성별 관계·조회에 유리하지만 상품 한 건의
속성을 구성할 때 여러 행을 모아야 한다. JSONB만 사용하면 운영자가 관리할 정의가 불분명해진다.

### 선택과 결과

`AttributeDefinition`에 타입·필수 여부·선택지와 카테고리 연결을 두고, 상품의 값은
`Product.attributes`에 저장한다. 애플리케이션이 정의에서 Zod 스키마를 만들어 저장 전에 검증한다.
상품 편집 폼과 검색 필터가 같은 정의를 사용한다.

속성 필터 검색은 Meilisearch가 담당하고 DB에서는 상품과 속성 값을 함께 읽는다.
이 프로젝트의 조회 경로에 맞춘 선택이며, EAV보다 항상 빠르다는 비교 측정은 하지 않았다.

**대가:** 일반적인 FK·CHECK만으로 JSONB 내부의 동적 정의 준수를 강제하지 못한다.
직접 SQL로 넣은 값은 애플리케이션 검증을 우회할 수 있고, 정의 변경과 기존 상품의 정합성도
별도로 살펴야 한다.

- 구현: [동적 검증](../apps/api/src/catalog/attribute-schema.ts), [속성 서비스](../apps/api/src/catalog/attribute.service.ts)
- 검증: [속성 검증](../apps/api/src/catalog/attribute-schema.spec.ts), [정의 변경 경합](../apps/api/test/db/attribute-lineage-contention.spec.ts)
- 검색 연결: [검색 문서 구성](../apps/api/src/search/search-document.ts)

## 3. 주문서에서 재고를 예약하는 이유

### 문제와 대안

주문서를 작성하는 동안 다른 사람이 마지막 재고를 살 수 있다. 결제 후에만 재고를 차감하면
결제 성공과 재고 확보가 어긋날 수 있다. 주문서를 열 때 판매로 차감하면 이탈 시 복원 규칙이 필요하다.

### 선택과 결과

`stock`과 `reserved`를 구분하고 주문서를 열 때 제한 시간의 예약을 만든다. 핵심 조건은 다음과 같다.

```sql
UPDATE "ProductVariant"
SET "reserved" = "reserved" + :quantity
WHERE "id" = :variantId
  AND "stock" - "reserved" >= :quantity;
```

이는 [실제 구현](../apps/api/src/reservation/reservation.service.ts)의 핵심만 요약한 의사 SQL이다.
조건 검사와 갱신이 한 문장이며 PostgreSQL의 행 잠금으로 경합을 처리한다. 명시적인
`SELECT FOR UPDATE`를 앞에 두지 않았다는 뜻이지 잠금이 없는 것은 아니다.

결제에 따라 예약을 확정하고 이탈·만료에는 해제한다. 여러 상품 예약은 한 트랜잭션으로 묶어
마지막 상품의 예약이 실패하면 앞의 예약도 롤백한다.

**대가:** 만료 배치·재고 캐시 대조가 필요하다. 예약 만료와 결제 승인이 경합할 수 있으므로
예약만으로 모든 결제 후 재고 불일치를 없앴다고 주장하지 않는다. 결제 복구와 주문 확정 경로를
함께 검증해야 한다.

- 검증: [실제 예약 통합](../apps/api/test/api/reservation.integration.spec.ts), [예약 만료](../apps/api/test/api/reservation-expiry.spec.ts), [결제 후속 복구](../apps/api/test/api/payment-straggler.spec.ts)
- 테스트 방식: [잘못된 구현으로 경합을 재현하는 대조군](../apps/api/test/db/stock-contention.spec.ts). 이 파일은 하네스용 픽스처이며 실제 서비스 검증은 위 통합 테스트가 맡는다.

## 4. 가상 카드와 토스 테스트를 같은 결제 포트로 묶은 이유

### 문제와 대안

방문자가 실제 결제 없이 구매·한도 부족·부분 환불을 체험할 수 있어야 한다. 성공 화면만
보여 주는 모킹으로는 거래 금액과 원장의 변화가 검증되지 않는다. 외부 PG만 사용하면
방문자 체험이 결제창과 외부 환경에 의존한다.

### 선택과 결과

가상 카드와 토스 테스트 어댑터를 같은 포트 뒤에 둔다. 포트에는 승인·매입·취소·환불뿐 아니라
상태 조회와 승인 결과 복구도 있다. 가상 카드는 사용액·한도·거래 원장을 실제 DB에 기록한다.
여기서 실제인 것은 상태와 원장의 변화이며 금융 거래가 아니다.

승인 결과는 `approved`, `declined`, `unknown`으로 나눈다. 응답이 오지 않았을 때 실패로
단정하면 PG는 승인했는데 내부 상태는 실패인 거래가 생길 수 있다. `UNRESOLVED`에 두고
프로바이더에 다시 조회하는 경로를 마련했다.

**대가와 남은 한계:** 프로바이더 왕복과 내부 DB 쓰기는 하나의 원자적 작업이 아니다.
특히 외부 환불 성공 후 내부 기록 실패 구간은 행 잠금과 긴 타임아웃만으로 해결되지 않는다.
현재 환불 포트에는 요청별 멱등 식별자가 없고 토스 취소 요청에도 전달하지 않는다.
이 장애 구간의 재시도·대사·중복 방지는 추가 설계와 검증이 필요하다.

- 구현: [결제 포트](../apps/api/src/payment/payment-provider.ts), [결제 서비스](../apps/api/src/payment/payment.service.ts), [토스 클라이언트](../apps/api/src/payment/toss.client.ts)
- 검증: [가상 카드 결제](../apps/api/test/api/virtual-card-payment.spec.ts), [대사](../apps/api/test/api/payment-reconcile.spec.ts), [웹훅](../apps/api/test/api/payment-webhook.spec.ts)
- 후속 범위: [공개 전 점검표](./portfolio-status.md)

## 5. DB와 검색 엔진의 역할을 나눈 이유

### 문제와 대안

상품 검색에는 오타 보정·자동완성·속성 패싯이 필요하다. PostgreSQL에서 직접 구현하면
검색 동작을 더 많이 만들어야 하고, 별도 검색 엔진은 운영·동기화 비용이 생긴다.
Elasticsearch도 대안이지만 이 프로젝트에서는 필요한 검색 기능과 설정·운영 부담을 기준으로
Meilisearch를 선택했다. 엔진 간 성능 벤치마크로 우열을 입증한 선택은 아니다.

### 선택과 결과

DB를 상품 원본으로 두고 Meilisearch는 검색용 문서를 가진다. 기본 시드는 상품 800개 규모다.
상품 몇만 건을 운영하거나 수억 건에서 검증했다고 소개하지 않는다.

상품 변경과 같은 DB 트랜잭션에 Outbox를 기록하고 워커가 색인을 갱신한다. 속성 정의에서
필터 가능한 필드 설정을 만든다. 인덱스가 비어 있는 부팅은 재색인으로 복구한다.

**대가:** 저장 직후 검색 결과에 반영되지 않을 수 있다. 색인 지연·재시도·재색인 비용을
관리해야 하며, 검색 실패를 검색 결과 0건과 구분해 표시해야 한다.

- 구현: [Outbox](../apps/api/src/search/search-outbox.service.ts), [인덱서](../apps/api/src/search/search-indexer.service.ts), [색인 설정](../apps/api/src/search/search-index-settings.ts)
- 검증: [색인 통합](../apps/api/test/api/search-indexing.integration.spec.ts), [검색 통합](../apps/api/test/api/search.integration.spec.ts)

## 6. 할인액 안분과 환불 계산

### 문제와 대안

3만원·2만원 상품에 5천원 쿠폰을 쓰면 할인액은 3천원·2천원으로 나뉜다. 배송비 조정과
적립금 사용이 없다면 2만원 상품을 취소할 때 현금 환불액은 1만 8천원이다.
환불 때 현재 쿠폰 정책으로 다시 계산하면 실제로 낸 금액과 달라질 수 있다.

### 선택과 결과

주문 시점에 할인액을 상품별로 안분해 저장한다. 정수 원 단위로 나누고 나머지는
금액이 큰 항목부터 한도 안에서 배분한다. 예를 들어 7원을 3:2로 나누면 절삭한 4원·2원에
남은 1원을 더해 5원·2원이 된다. 같은 입력 순서와 규칙으로 결과를 결정한다.

배송비는 판매자 단위로 다룬다. 부분 취소로 무료배송 조건이 깨지면 재부과를 계산하고,
현금과 적립금은 각자의 수단으로 복구한다. 클레임의 수량과 이전 환불을 반영하는 서비스가
공통 계산 함수 위에서 처리 순서를 관리한다.

**대가:** 단순한 상품금액 차감보다 저장할 스냅샷과 정책이 많다. 모든 취소·반품에서
현금 환불 총액이 최초 결제액과 같다는 주장은 부정확하다. 배송비 재부과·반품비·적립금
복구를 구분해야 하며, 보존 관계는 해당 정책의 조건 안에서 검증한다.

- 구현: [안분](../packages/shared/src/pricing/allocate.ts), [기본 환불 계산](../packages/shared/src/pricing/refund.ts)
- 검증: [계산 함수](../packages/shared/test/pricing.spec.ts), [클레임·환불·복구](../apps/api/test/api/refund.spec.ts), [카드 잔액을 확인하는 E2E](../e2e/tests/refund.spec.ts)
- 규칙: [금액 설계](./design/pricing.md)
