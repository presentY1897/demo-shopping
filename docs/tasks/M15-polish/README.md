# M15. 마무리

성능·접근성을 점검하고 포트폴리오로서 완성한다. **채용 담당자가 5분 안에 이 프로젝트를 이해할 수 있는 상태**를 만드는 것이 목표다.

| ID | 제목 | 상태 | 선행 |
| --- | --- | --- | --- |
| [TASK-0097](./TASK-0097-performance.md) | 성능 최적화 · 측정 | 완료 | M14 |
| [TASK-0098](./TASK-0098-accessibility.md) | 접근성 점검 | 완료 | M14 |
| [TASK-0099](./TASK-0099-e2e-demo.md) | E2E 테스트 · 데모 시나리오 | 완료 | M14 |
| [TASK-0100](./TASK-0100-portfolio-docs.md) | README · 포트폴리오 문서 | 승인됨 | 0097, 0098, 0099 |
| [TASK-0122](./TASK-0122-factory-clock.md) | 테스트 팩토리의 데이터베이스 시계 | 완료 | 0120 |
| [TASK-0121](./TASK-0121-racy-optimistic-spec.md) | 낙관적 갱신 검사의 타이밍 가정 | 완료 | 0029 · 0120 |
| [TASK-0123](./TASK-0123-storefront-copy-cleanup.md) | 구매자 메인 설명 정리 | 완료 | 0044 · 0101 |
| [TASK-0124](./TASK-0124-storefront-checkout-review.md) | 구매자 반응 속도·결제 UX 검토 | 완료 | 0123 |
| [TASK-0125](./TASK-0125-payment-idempotency.md) | 결제 생성·승인 중복 방지 | 완료 | 0124 |
| [TASK-0126](./TASK-0126-payment-result-recovery.md) | 끊긴 결제 결과 복구·재시도 통일 | 완료 | 0125 |
| [TASK-0127](./TASK-0127-paid-cart-cleanup.md) | 결제 확정 후 구매한 장바구니 정리 | 완료 | 0126 |
| [TASK-0128](./TASK-0128-checkout-input-preservation.md) | 배송지 이동·배송 요청사항 보존 | 완료 | 0127 |
| [TASK-0129](./TASK-0129-purchase-ux-consistency.md) | 구매 안내·오류 피드백·모바일 동선 정리 | 완료 | 0128 |
| [TASK-0130](./TASK-0130-storefront-loading-performance.md) | 홈 선행 대기 제거·상품 이미지 경량화 | 완료 | 0124 |
| [TASK-0131](./TASK-0131-checkout-api-latency-analysis.md) | 장바구니·결제 API 지연 원인 측정 | 진행중 | 0124 |
| [TASK-0132](./TASK-0132-payment-finalization-batching.md) | 복수 상품 결제 후처리의 DB 왕복 축소 | 완료 | 0125 · 0127 · 0131 측정 근거 |
| [TASK-0133](./TASK-0133-checkout-roundtrip-reduction.md) | 주문서 진입·주문 생성 DB 왕복 축소 | 완료 | 0132 |
| [TASK-0134](./TASK-0134-payment-request-deadline.md) | 결제 응답 대기 제한 조정 | 완료 | 0133 |
| [TASK-0135](./TASK-0135-payment-read-roundtrips.md) | 결제의 반복 조회 축소 | 완료 | 0134 · 0131 측정 |
| [TASK-0136](./TASK-0136-neon-region-alignment.md) | Neon DB와 API 리전 일치 | 완료 | 0135 · 대상 준비 |
| [TASK-0137](./TASK-0137-product-thumbnail-consistency.md) | 세 앱 상품 썸네일 표시 통합 | 진행중 | 0129 |
| [TASK-0138](./TASK-0138-product-thumbnail-generation.md) | 상품 이미지 자동 썸네일 생성과 데이터 연결 | 승인됨 | 0011 · 0033 · 0130 |
