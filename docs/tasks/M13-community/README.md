# M13. 회원 부가 기능

리뷰·위시리스트·최근 본 상품·알림·Q&A·팔로우를 만든다. (D-030)

리뷰는 `orderItemId` unique 로 **구매 검증을 스키마가 강제**한다. 구매하지 않은 사람은 행을 만들 수 없고 중복 리뷰도 DB 가 막는다.

**완료 조건**: 구매한 상품에만 리뷰를 쓸 수 있고, 주문 상태가 바뀌면 알림이 도착한다.

| ID | 제목 | 상태 | 선행 |
| --- | --- | --- | --- |
| [TASK-0083](./TASK-0083-review-write.md) | 리뷰 스키마 · 작성 (구매 검증) | 승인 대기 | M12 |
| [TASK-0084](./TASK-0084-review-display.md) | 리뷰 표시 · 평점 집계 | 승인 대기 | 0083 |
| [TASK-0085](./TASK-0085-review-reply.md) | 판매자 리뷰 답변 | 승인 대기 | 0084 |
| [TASK-0086](./TASK-0086-wishlist.md) | 위시리스트 | 승인 대기 | M12 |
| [TASK-0087](./TASK-0087-recently-viewed.md) | 최근 본 상품 | 승인 대기 | M12 |
| [TASK-0088](./TASK-0088-product-qna.md) | 상품 Q&A | 승인 대기 | M12 |
| [TASK-0089](./TASK-0089-seller-follow.md) | 판매자 팔로우 | 승인 대기 | 0086 |
| [TASK-0090](./TASK-0090-notification.md) | 알림 시스템 | 승인 대기 | M12 |
| [TASK-0091](./TASK-0091-report.md) | 신고 처리 | 승인 대기 | 0084, 0088 |
