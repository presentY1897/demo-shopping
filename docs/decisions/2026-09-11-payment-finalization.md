# D-274: 결제 후처리를 도메인 서비스 내부에서 일괄 기록

TASK-0131의 실 DB 지연 재현에서 두 상품의 매입 후처리가 기본5초 제한을 넘었다. 사용자 계속 진행 지시로 TASK-0132를 분리해 기존 정합성 경계 안에서 DB 왕복을 줄인다.

Order 잠금·단일 후처리 transaction·기본 timeout을 유지한다. StockService가 예약별 seq/balanceAfter를 보존하여 원장을 일괄 기록하고, SellerOrderService가 기존 transitionDecision과 행 잠금 아래 PAID 상태/이력을 일괄 기록한다. 원본 장바구니 항목의 소유자/id/수량/시각 조건도 유지한다. 상품 수에 비례하는 SQL 왕복을 피하며 알림은 커밋 뒤에 발행한다. 결제/상태/API 정책 변경은 없다.
