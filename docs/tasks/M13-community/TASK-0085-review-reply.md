# TASK-0085: 판매자 리뷰 답변

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M13 회원 부가 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/review-reply` |
| 선행 작업 | TASK-0084 |

## 1. 목적

판매자가 리뷰에 답변하는 기능을 만든다.

## 2. 범위

### 포함
- `ReviewReply` — 리뷰당 1개, 판매자 소유
- 답변 작성·수정·삭제 (자기 상품 리뷰만)
- 판매자 리뷰 관리 화면 (미답변 우선, 평점 필터)
- 상품 상세에 답변 표시
- 미답변 건수 뱃지
- 신규 리뷰 알림 이벤트

### 제외
- 신고 처리 (TASK-0091)

## 3. 요구사항

- [x] 판매자가 자기 상품 리뷰에만 답변할 수 있다
- [x] 리뷰당 답변은 1개다
- [x] 답변이 상품 상세에 표시된다
- [x] 미답변 리뷰가 우선 표시된다

## 4. 설계

답변은 **삭제 후 재작성이 아니라 수정**을 허용한다. 다만 수정 이력을 남길 필요는 없다 — 판매자 응대는 개선이 목적이지 기록 보존이 목적이 아니다.

리뷰 관리 화면은 낮은 평점부터 볼 수 있게 필터를 둔다. 대응이 필요한 리뷰를 먼저 찾는 게 실제 사용 패턴이다.

### 4.1 답할 자격의 출처는 리뷰가 아니라 상품이다

리뷰는 산 사람의 것이지만 답변은 **판 사람**의 것이고, 그 둘을 잇는 것이 상품이다. 그래서 서비스는 리뷰에서 상품으로, 상품에서 스토어로 올라가 그 스토어에 대한 접근을 묻는다 — **리뷰의 작성자를 한 번도 읽지 않는다** (D-245).

### 4.2 두 번째 답변이 저장될 자리가 없다

`ReviewReply` 의 기본키가 `reviewId` 다. 「두 번 쓰면 400」과 「두 번 쓰면 수정」 중 무엇을 고르든 그 판단이 애플리케이션에만 있으면 우회 경로가 생기는 날 뚫린다.

고쳐 쓰는 쪽을 골랐고(F3), **수정 이력은 남기지 않는다** — 리뷰 쪽에 수정 기한이 있는 것과 반대인데, 저쪽은 **남의 판단**을 바꾸는 일이고 이쪽은 자기 말을 고치는 일이기 때문이다.

### 4.3 남의 상품 리뷰에는 403 이다

404 로 답하지 않는 이유는 **리뷰가 공개**이기 때문이다. 존재를 숨길 것이 없는 자리에서 404 를 주면 판매자에게 「그런 리뷰가 없다」는 거짓말을 하게 된다 — 리뷰 작성 쪽이 404 를 쓰는 것과 반대이고, 그쪽은 남의 **주문 항목**이라 숨길 것이 있다.

### 4.4 답변은 리뷰 목록과 함께 온다

따로 받으면 리뷰 한 장마다 요청이 하나씩 늘고, 그것이 바로 N+1 이다 (F4).

### 4.5 미답변 건수는 필터와 무관하다

뱃지는 「지금 화면에 몇 개」가 아니라 **「할 일이 몇 개」**다. 필터를 켜면 줄어드는 뱃지는 할 일을 숨긴다 (F7).

## 5. 구현 계획

1. 스키마·마이그레이션
2. 답변 CRUD API (소유권 검사)
3. 판매자 리뷰 관리 화면
4. 상품 상세 답변 표시
5. 뱃지·알림 이벤트

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 답변 작성 | `review-reply.spec.ts`(api) 「자기 상품 리뷰에 답한다」 — 스토어의 브랜드명이 함께 온다 · `review-reply.spec.tsx`(seller) 「sends what was typed, to the review it was typed under」 · 「shows the saved reply on the row, and says so」 | 저장·표시 | [x] |
| F2 | 소유권 | `review-reply.spec.ts`(api) 「남의 상품 리뷰에는 답할 수 없다 (F2)」 · 「구매자는 답할 수 없다」 — 자격의 출처가 리뷰가 아니라 상품이라 둘이 같은 답이다 (4.1) · `review-reply.spec.tsx`(seller) 「says whose store it is when the review belongs to somebody else」 | 403 | [x] |
| F3 | 1개 제한 | `review-reply.spec.ts`(api) 「두 번 쓰면 고쳐진다 (F3)」 — 행이 **하나뿐인 것**까지 단언한다 (`ReviewReply` 의 기본키가 `reviewId` 다) · `review-reply.spec.tsx`(seller) 「overwrites through the same door the first answer went through」 | 두 번째는 수정으로 처리 또는 400 | [x] |
| F4 | 상세 표시 | `review-reply.spec.ts`(api) 「리뷰 목록에 답변이 실린다」 — 리뷰 목록에 실려 오므로 요청이 리뷰 수만큼 늘지 않는다 (4.4) · `product-reviews.spec.tsx`(shop) 「draws the seller reply under the review it answers」 | 리뷰 아래 답변 표시 | [x] |
| F5 | 미답변 우선 | `review-reply.spec.ts`(api) 「미답변이 위에 온다 (F5)」 · `review-console.spec.ts`(seller) 「is about the reply, not about the rating (F5)」 · `review-list.spec.tsx`(seller) 「keeps the order the server sent, unanswered first or not (F5)」 — 순서를 정하는 곳이 서버 하나다 | 미답변이 상단 | [x] |
| F6 | 평점 필터 | `review-reply.spec.ts`(api) 「낮은 평점만 거를 수 있다 (F6)」 · `review-list.spec.tsx`(seller) 「sends the rating ceiling the seller chose」 · `review-console.spec.ts`(seller) 「offers no "5점 이하", because that is the same list as 전체」 | 해당 리뷰만 표시 | [x] |
| F7 | 뱃지 | `review-reply.spec.ts`(api) 「미답변 건수가 필터와 무관하다 (F7)」 (두 건이면 2다) · 「답하면 미답변 건수가 준다」 · `review-list.spec.tsx`(seller) 「reports what the server counted, not what this page shows」 · 「does not shrink when a filter is switched on」 (4.5) | 미답변 건수 증가 | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **2장**: 상품 상세는 전 항목, 판매자 화면은 P1~P5
- **3~4장 전 항목 적용**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 답변으로 구매자와 분쟁 | 신고 기능으로 관리자 개입 경로 확보 (TASK-0091) |
| R2 | **신규 리뷰 알림이 없다** — 2장에 적힌 「신규 리뷰 알림 이벤트」가 닫히지 않았다. 판매자용 리뷰 알림 유형이 `notificationTypes` 에 아예 없고, 리뷰 서비스는 알림 서비스를 주입조차 하지 않는다 | 6.1 에 해당 행이 없어 이 TASK 를 막지는 않는다. 판매자는 미답변 **건수 배지**(F7)로 새 리뷰를 안다 — 알림은 그것을 더 빠르게 만들 뿐이다. 유형을 하나 더 만드는 일이라 M14 에서 다룬다 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-07 | 완료. 판매자 리뷰 콘솔·상세 표시까지 확인. 2장의 「신규 리뷰 알림」은 유형 자체가 계약에 없어 열린 채로 남는다 (7장) |
