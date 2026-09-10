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
| [TASK-0132](./TASK-0132-payment-finalization-batching.md) | 복수 상품 결제 후처리의 DB 왕복 축소 | 진행중 | 0125 · 0127 · 0131 측정 근거 |
