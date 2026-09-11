# D-276: 결제의 불변 식별자 재사용과 응답 단일 조회

운영 DB 왕복 약200ms 조건에서 결제 생성/승인/확정의 반복 조회가 누적된다. 소유권을 확인한 결제의 provider/orderId/methodRef를 같은 작업에서 재사용하고, 응답은 Payment·Order·User·Refund의 단일 SQL projection으로 읽는다.

응답 소유권은 accountOwnershipSelect 필드로 구성해 기존 assertResourceAccess를 적용한다. 사용자 입력으로 SQL 식별자를 만들지 않는다. 환불은 refundedAt/id 순, 날짜는 기존 UTC millisecond 계약을 유지한다. 상태 판단은 여전히 잠금 아래의 최신 행을 사용하고 승인 실행권 CAS·원장 유일성·transaction/보상 경계는 유지한다.

[근거와 비교](../reviews/2026-09-11-payment-read-latency.md), [TASK0135](../tasks/M15-polish/TASK-0135-payment-read-roundtrips.md).
