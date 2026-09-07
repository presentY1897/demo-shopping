# TASK-0095: 전체 상품 · 주문 조회

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M14 관리자 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/admin-catalog-orders` |
| 선행 작업 | M13 완료 |

## 1. 목적

관리자가 판매자 구분 없이 전체 상품과 주문을 조회하고 필요한 조치를 취한다.

## 2. 범위

### 포함
- 전체 상품 목록 (판매자·카테고리·상태 필터, 검색)
- 상품 강제 숨김·해제 (사유 기록)
- 전체 주문 조회 (주문번호·구매자·판매자·기간 검색)
- 주문 상세 (판매자별 묶음 전체 표시)
- 결제·환불 내역 조회
- CS 대응용 주문 검색 (주문번호·연락처)
- 데모 관리자는 강제 숨김 불가

### 제외
- 주문 강제 변경 (클레임 경로로만 — TASK-0071)

## 3. 요구사항

- [x] 전체 상품·주문을 검색할 수 있다
- [x] 부적절한 상품을 숨길 수 있다
- [x] 주문번호로 즉시 찾을 수 있다
- [x] 결제·환불 내역을 확인할 수 있다
- [x] 관리자가 주문 상태를 임의로 바꿀 수 없다

## 4. 설계

**주문 상태를 관리자가 직접 바꾸지 못하게 한다.** 상태 변경은 클레임 처리(TASK-0071)를 거쳐야 한다. 직접 변경을 허용하면 재고·환불·정산이 따라가지 않아 데이터가 어긋난다. 관리자에게도 정해진 경로만 준다.

CS 대응 검색은 주문번호·연락처 뒷자리로 빠르게 찾을 수 있게 한다.

### 4.1 전체 상품 목록은 이미 있다

`GET /products` 가 `product.read:any` 를 든 사람에게 이미 모든 스토어의 상품을 답한다 (F1). 이 TASK 가 더하는 것은 **관리자만 하는 일** — 강제로 내리기와, 주문을 사람·스토어·기간으로 가로질러 찾기다.

### 4.2 내리는 동작은 신고 처리와 **같다**

판매를 멈추는 것이 가리는 것이다 (`report.service.ts` 가 같은 판단을 먼저 했다). 다른 것은 **근거가 어디 있는가**다 — 신고를 통한 숨김은 신고 행이 사유와 처리자를 들고 있지만, 직접 내리는 데에는 가리킬 행이 없어 상품에 적는다.

색인에서도 함께 뺀다. **목록에는 없는데 검색으로는 나오면 그것은 안 가려진 것이다.**

**판매 중인 것만 내리고 내려진 것만 올린다.** 초안을 `ACTIVE` 로 올리면 값 없는 상품이 진열되고 그것은 `Product_active_price_check` 가 막는데, 그 500 은 관리자에게 아무 뜻도 없다. 안 되는 경우를 조용히 넘기지 않고 답하는 이유는, **아무 일도 안 일어났는데 「내렸다」를 받은 관리자가 그 상품을 다시 보러 오지 않기** 때문이다.

사유는 필수이고, 시각·사유·처리자 셋이 함께 있거나 셋 다 없다 (`Product_moderation_check`). 사유 없이 내려진 상품은 판매자에게 설명할 방법이 없고, 처리자가 없으면 누구에게 물어야 할지도 모른다.

### 4.3 주문은 **묶음을 전부** 싣는다

하나만 보이면 다중 판매자 주문의 절반이 화면에서 사라지고, CS 는 「그 주문 맞는데 그 상품이 없다」를 보게 된다. 묶음은 한 번에 읽는다 — 주문마다 물으면 스무 줄이 스물한 번이 된다 (A5).

주문번호는 **정확히 일치**로 찾는다. CS 가 가장 먼저 손에 쥐는 값이고, 부분 일치로 두면 비슷한 번호가 섞여 나온다.

산 사람의 이름은 **가려서** 나간다. 훑어보는 화면이라 회원 목록과 같은 판단이다 (TASK-0093 4.2).

### 4.4 주문 상태를 직접 바꾸는 문은 **없다**

일부러 없다. 상태를 손으로 옮기면 재고·정산·환불이 따라오지 않고, 그 어긋남은 몇 단계 뒤에 「정산 금액이 이상하다」로 나타난다 — **원인과 증상이 멀어서 아무도 그 둘을 잇지 못한다.**

관리자가 결과를 바꿔야 하면 클레임 개입으로 간다 (TASK-0071). 그 경로는 재고와 환불을 함께 움직인다.

### 4.5 데모 제한은 **매퍼를 지난다**

데모 관리자는 `catalog.write` 가 `demo` 로 좁혀져 있어 실계정의 상품을 내리지 못한다 (D-058). 그 판정은 대상의 주인이 데모인가로 하는데, **그 컬럼을 서비스가 직접 읽지 않는다** — 소유 판정에 필요한 칸은 매퍼가 정한다. 여기서 컬럼 이름을 적으면 데모 판정이 서비스마다 퍼지고, 다음 서비스가 잊는 순간 구멍이 된다 (`demo-containment.spec.ts`).

## 5. 구현 계획

1. 전체 상품 목록·검색
2. 강제 숨김·해제
3. 전체 주문 조회·검색
4. 주문 상세 (전체 묶음)
5. 결제·환불 내역 표시
6. 데모 제한

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 전체 상품 | 목록은 이미 있었다 (4.1) — 이 TASK 가 더한 것은 **이름 검색**이다. `admin-console.spec.ts` 「finds a listing that is not on sale, which the index cannot」 — 색인은 `ACTIVE` 만 담는데 관리자가 정작 찾는 것은 초안이거나 강제로 내려진 상품이라, 이 목록만 DB 를 직접 본다 · 「treats a percent sign as a character, not a wildcard」 (이스케이프하지 않으면 `50%` 로 찾는 사람이 전부를 받고 **필터가 조용히 사라진다**) · `products-list.spec.ts` 「refuses a caller with no store of their own, however wide their grants」 가 문이 어디인지를 못 박는다 — `any` 로 남의 카탈로그를 보는 자리는 `/seller/` 가 아니라 `GET /products` 다 · `products-page.spec.tsx` 「draws every store’s listing, with the store and the category as names」 · 「searches by name, and says it also finds what is not on sale」 · 「does not search while somebody is still typing」 | 모든 판매자 상품 표시 | [x] |
| F2 | 강제 숨김 | `admin-console.spec.ts` 「stops the sale and writes why, and who」 · 「tells the search index to drop it」 — **목록에는 없는데 검색으로 나오면 그것은 안 가려진 것이다** (4.2). `SearchOutbox` 의 마지막 줄이 `REMOVE` 인 것까지 본다 · 「refuses to hide something that is not on sale」 (409 — 초안은 이미 안 팔리고 있다) · 「puts it back on sale and clears the record」 · 구매자 쪽은 `products.integration.spec.ts` 「is a 404 for a %s listing (F9)」 의 `SUSPENDED` 갈래와 「shows a buyer only what is on sale」 가 받고, 「refuses a seller who tries to lift their own forced hide」 가 판매자가 풀 수 있는 강제 숨김은 강제 숨김이 아니라는 것을 잰다 · `catalog-console.spec.ts` 「offers 내리기 only for a listing that is on sale」 · 「offers 다시 올리기 only for one that was pulled」 · `products-page.spec.tsx` 「sends the reason once it is written, and re-reads the list」 · 「tells the operator that hiding also takes the listing out of search」 | 구매자 화면·검색에서 제외 | [x] |
| F3 | 사유 기록 | `admin-console.spec.ts` 「refuses to hide without a reason」 — 공백 세 칸을 보내 400 을 받는다 · 「stops the sale and writes why, and who」 가 사유와 함께 `moderatedById` 까지 단언한다 · 「carries the moderation reason into the list」 — 되돌리는 사람이 **왜 내려졌는지** 못 보면 그것은 되돌리기가 아니라 덮어쓰기다 · `products-page.spec.tsx` 「refuses to send with no reason, and says so under the field」 (요청이 아예 안 나가는 것까지 단언한다). 다만 **마지막 방어선인 `Product_moderation_check`(시각·사유·처리자 셋이 함께 있거나 셋 다 없다)를 직접 거스르는 검사는 없다** — 서비스를 건너뛴 쓰기는 이 표에서 재본 적이 없다 | 차단 | [x] |
| F4 | 주문 검색 | `admin-console.spec.ts` 「finds an order by its number, with every seller bundle」 · 「refuses a buyer, whose order.read is their own」 · `orders-page.spec.tsx` 「searches by an exact order number, with the pasted whitespace trimmed」 — CS 가 가장 먼저 손에 쥐는 값이라 정확히 일치이고, 붙여 넣은 공백만 떼어 낸다 (4.3) · 「says out loud that the number has to match exactly」 · 「does not go out on every keystroke」 · 「narrows by store and by period」 · `catalog-console.spec.ts` 「trims the order number before it goes out」 · 「refuses a range whose start is after its end」 — 뒤집힌 기간은 서버가 **200 과 빈 목록**으로 답하므로 아무도 그것이 조건 탓이라 말해 주지 않는다 | 즉시 조회 | [x] |
| F5 | 주문 상세 | `orders-page.spec.tsx` 「draws every seller bundle of a split order, in the list itself」 — 하나만 보이면 다중 판매자 주문의 절반이 화면에서 사라진다 (4.3) · 「lists the bundles again without asking the API for them」 (묶음은 목록의 줄이 이미 들고 있어 다시 묻는 것은 결제뿐이다) · 「shows the masked buyer name and says why it is masked」 · `admin-console.spec.ts` 「finds an order by its number, with every seller bundle」 가 계약에 묶음이 실리고 산 사람의 이름이 가려져 나간다는 것을 받는다. 다만 **API 쪽은 판매자 하나짜리 주문으로만 잰다** — 둘로 갈린 주문을 서버가 실제로 한 줄로 묶어 내는지는 대역을 세운 화면 검사만 확인한다 | 모든 묶음 표시 | [x] |
| F6 | 결제 내역 | `admin-console.spec.ts` 「answers the payment and refund trail」 — 부분 취소 4,000원이 `refundedAmount` 로 합쳐져 온다 · `orders-page.spec.tsx` 「reads the payments and totals what was refunded」 · 「says 승인 전 rather than leaving the approval time blank」 — 승인 전에 끊긴 결제 시도가 실제로 남고, 빈칸은 못 읽었다는 뜻과 섞인다 · 「offers a retry when the payments could not be read」 · `catalog-console.spec.ts` 「says nothing rather than a blank for a payment that was never approved」 | 결제·환불 내역 표시 | [x] |
| F7 | 상태 변경 차단 | **없는 문에 대한 기준이라 403 으로는 잴 수 없다** (4.4). `orders-page.spec.tsx` 「offers no way to move the order, and says why, and points at the claim route」 가 그 자리다 — 상세에 셀렉트가 하나도 없고 버튼이 닫기 **하나뿐**이라는 것까지 세므로, 상태를 옮기는 컨트롤이 하나라도 생기면 빨개진다. 그리고 화면은 없다는 사실과 이유와 **대신 갈 곳**(`/claims` 링크)을 함께 말한다 — 버튼이 그냥 없으면 읽는 사람은 그것을 자기 권한 문제로 읽는다. 그 경로가 실제로 결과를 움직인다는 것은 `admin-claim.spec.ts` 「moves the order to RETURNED once the goods have passed inspection」 이 받는다. 서버 쪽 근거는 검사가 아니라 표면이다: `AdminConsoleController` 도 `lib/catalog/console-api.ts` 도 주문 상태를 쓰는 문을 내놓지 않는다 | 불가, 클레임 경로 안내 | [x] |
| F8 | 데모 제한 | `admin-console.spec.ts` 「refuses a demo admin on a real account’s product」 (403) · `catalog-console.spec.ts` 「names the 403 a demo administrator gets on a real account listing (F8)」 — 카탈로그의 공통 거절 문장은 **어느 자격이 어떻게 좁혀져 있는지**를 말하지 못한다 · `products-page.spec.tsx` 「explains the 403 a demo administrator gets on a real account’s listing」 · 「warns a demo administrator before they even try」 (어느 상품이 데모의 것인지는 줄에 없어 버튼을 미리 죽일 수 없다) · `demo-containment.spec.ts` 「names the demo flag nowhere outside the authorization layer」 — 판정이 매퍼(`accountOwnershipSelect`)를 지나므로 `admin-catalog.service.ts` 는 그 허용 목록에 **없다** (4.5) | 403 | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **2장**: P1~P5. **P6 해당 없음**
- **3장 전 항목 적용**
- **4장 해당 없음**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 전체 조회가 느림 | 검색 조건 없는 전체 조회를 막고 필터를 강제 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-07 | 완료. 2장의 「검색」이 빠져 있었다 — `GET /products` 에 검색어가 없어 화면이 「찾을 수 없습니다」를 안내하고 있었다. **검색 엔진이 대신할 수 없다**(색인은 판매 중인 것만 담는다). 강제 숨김의 사유를 목록에 실어 되돌리는 사람이 근거를 보게 했다 |
