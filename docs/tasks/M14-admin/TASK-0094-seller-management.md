# TASK-0094: 판매자 관리

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M14 관리자 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/seller-management` |
| 선행 작업 | M13 완료 |

## 1. 목적

입점 승인(M04)에서 만든 화면을 확장해 판매자 운영 관리를 완성한다.

## 2. 범위

### 포함
- 판매자 목록 (상태·매출·클레임률 필터)
- 판매자 상세 — 상품 수, 매출, 정산 현황, 클레임률, 평균 평점
- 승인·반려·정지·해제 (M04 기능 통합)
- 개별 수수료율 설정 (M12 연동)
- 제재 이력
- 판매자별 지표 비교
- 데모 판매자 구분 표시

### 제외
- 정산 처리 (M12)

## 3. 요구사항

- [x] 판매자별 운영 지표를 볼 수 있다
- [x] 문제 판매자를 지표로 찾을 수 있다
- [x] 정지 시 기존 주문 처리는 계속 가능하다
- [x] 개별 수수료율을 설정할 수 있다

## 4. 설계

**클레임률을 지표로 두는 이유**: 마켓플레이스 운영에서 판매자 품질 관리가 핵심이다. 반품·취소가 많은 판매자를 지표로 찾아낼 수 있어야 관리 화면으로서 의미가 있다.

```
클레임률 = 클레임 건수 / 주문 건수
```

정지 시 동작은 M04 설계를 따른다 — 상품 등록은 막고 기존 주문 처리는 허용한다. 구매자 피해를 막기 위함이다.

### 4.3 만들기 전에 **이미 있는 것부터 셌다**

승인·반려·정지·해제는 M04 의 `AdminSellerController` 에, 개별 수수료율은 M12 의 `CommissionController` 에 이미 있다. 이 TASK 가 더하는 것은 **지표와 이력**뿐이고, 그 둘이 없어서 관리자가 「어느 스토어를 봐야 하는가」에 답할 수 없었다.

경로도 나눴다 — `admin/stores` 다. M04 의 심사 콘솔이 `admin/sellers/:id` 를 쓰고 있어 같은 자리에 이름을 하나 더 두면 **그 이름이 uuid 로 읽힌다.** 묻는 축이 다르므로 경로도 다르다: 저쪽은 「이 신청을 승인할까」이고 이쪽은 「어느 스토어를 봐야 하나」다.

### 4.4 지표를 **한 질의로** 센다

스토어마다 매출·클레임·상품 수를 따로 물으면 스토어가 스무 곳일 때 조회가 예순 번이다 — 그리고 그 회귀는 기능 검사를 하나도 빨갛게 만들지 않는다 (A5). 셋을 미리 묶어 두고 이어 붙인다.

평점은 **리뷰 수로 가중한 평균**이다. 상품별 평균의 평균은 리뷰 한 건짜리 상품을 백 건짜리와 같은 무게로 세어 스토어의 평점을 흔든다.

### 4.5 클레임률은 주문이 없으면 **`null`** 이다

0이 아니다. 「클레임이 한 건도 없는 좋은 스토어」와 「아직 아무것도 안 판 스토어」는 다른 사실이고, 0으로 두면 **신규 스토어가 목록의 맨 위에 올라온다** — 클레임률 높은 순으로 보려던 사람이 정작 봐야 할 스토어를 못 본다. 정렬도 주문이 있는 스토어만 줄을 선다.

정수 100배로 싣는다 (3.5% = `350`). 소수를 실으면 화면마다 반올림이 달라지고, 두 화면이 같은 스토어를 다른 수로 그린다 — 평점이 이미 같은 판단을 했다.

### 4.6 이력은 옮기는 **트랜잭션 안에서** 남는다

`Seller` 는 지금 상태와 사유만 들고 있어 정지와 해제를 반복하면 앞의 것이 덮인다. 「이 스토어가 몇 번 정지됐나」에 답할 수 없다는 뜻이고, 그 답이 없으면 **반복 위반과 한 번의 실수를 구별할 수 없다.**

밖에 두면 「상태는 바뀌었는데 이력은 없다」가 가능해지고, 그 조합이 정확히 이 표가 막으려던 것이다.

**처리자에 외래키를 걸지 않는다** — `OrderStatusHistory` · `ClaimStatusHistory` 와 같다. 이력은 append-only 이고 주체가 사라져도 남아야 하는데, 외래키를 걸면 그 주체가 실재해야만 **상태를 옮길 수 있게** 된다. 기록을 남기는 일이 기록되는 일을 막아서는 안 된다.

정렬은 시각과 id 를 함께 본다. 한 트랜잭션 안에서 두 번 옮기면 시각이 같고, 그때 시각만으로 정렬하면 순서가 실행마다 뒤집힌다 — 이력은 순서가 곧 뜻이다.

## 5. 구현 계획

1. 목록 API (지표 집계·필터)
2. 목록 화면
3. 상세 화면 (지표·이력)
4. 상태 처리 통합
5. 수수료율 설정 연동
6. 제재 이력

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 지표 | `admin-console.spec.ts` 「counts sales, claims and products for every store in one answer」 — 매출·클레임·상품 수가 **한 답에** 함께 온다 (4.4) · 「says nothing rather than zero for a store that has not sold」 · `stores-page.spec.tsx` 「shows sales, the claim rate and the rating for a store that has traded」 · 「says 판매 없음 — never 0% — for a store that has never sold」 · 「says 평가 없음 rather than 0.0 for a store nobody has reviewed」 · `store-console.spec.ts` 「reads the contract integer as hundredths of a percent」 · 「reads 420 as 4.2」 — 100배를 되돌리는 자리가 함수 하나여야 두 화면이 같은 스토어를 다른 수로 그리지 않는다. 다만 **평점의 리뷰 수 가중 평균(4.4)을 재는 검사는 없다** — 화면은 계약이 준 수를 그대로 그리므로 그 SQL 이 상품별 평균의 평균으로 돌아가도 전부 초록이다 | 매출·클레임률·평점 표시 | [x] |
| F2 | 필터 | `admin-console.spec.ts` 「sorts by claim rate without letting the untraded store to the top」 — **4.5 가 통째로 이 한 줄에 걸려 있다**: 0으로 두면 아직 아무것도 안 판 스토어가 목록의 맨 위에 앉고, 클레임률을 보러 온 사람이 정작 봐야 할 스토어를 못 본다 · 「says nothing rather than zero for a store that has not sold」 · `store-console.spec.ts` 「is null — not zero — for a store that has never sold」 · 「is narrowed by a status」 · 「keeps false apart from "not chosen"」 (`isDemo=false` 는 데모 아닌 것만 보겠다는 뜻이지 안 골랐다는 뜻이 아니다) · `stores-page.spec.tsx` 「asks the API for the claim-rate order and goes back to the first page」 · 「narrows by status, and says the emptiness is the filter’s」 | 정확히 정렬 | [x] |
| F3 | 승인 흐름 | **M04 가 이미 증명한 자리다** (4.3). `sellers.integration.spec.ts` 「turns the store ACTIVE and grants SELLER_OWNER」 · `seller-approval.spec.ts`(db) 「leaves the store PENDING when the role grant fails」 · 「lands both halves once the grant is possible again」 — 상태와 역할이 한 트랜잭션이라 반쪽만 남지 않는다 · `sellers-page.spec.tsx` 「approves an application with one request and shows the new status」. 이 TASK 가 더한 것은 그 전이가 **이력으로 남는다**는 것뿐이고, 그것은 F6 이 잰다 | ACTIVE 전환 + SELLER 역할 | [x] |
| F4 | 정지 동작 | **M04.** `sellers-capability.spec.ts` 「closes the catalogue and leaves order handling open」 — 이미 돈을 낸 사람에게는 물건이 가야 한다 · 「answers every status against both capabilities the same way the table does」 가 상태 넷 × 자격 둘의 여덟 칸을 전부 돈다 · 「tells a suspended seller apart from one still waiting for review」 (둘 다 403 이지만 사람이 할 일이 다르므로 문장이 다르다) · `products-list.spec.ts` 「lists for a suspended store and refuses its writes」 | 상품 등록 불가, 주문 처리 가능 | [x] |
| F5 | 수수료율 | **M12.** `commission.spec.ts` 「설정한 요율이 주문 항목에 박힌다」 (스토어 범위로 건 개별 요율이다) · 「요율을 바꿔도 이미 만들어진 주문은 따라 움직이지 않는다」 — 이 칸의 목표가 말하는 **이후**의 반대쪽을 재는 검사이고, 이것이 없으면 요율 변경이 과거 주문까지 끌고 가는 구현도 통과한다 · 「최고 관리자는 요율을 바꾼다」 · 「운영자는 읽지만 바꾸지 못한다」 · `commissions-page.spec.tsx` 「carries the store id and nothing else for a seller rate (F2)」 | 이후 주문에 적용 | [x] |
| F6 | 제재 이력 | `admin-console.spec.ts` 「keeps every move, so repeating a suspension is visible」 — M04 의 승인·정지 문을 실제로 두드린 뒤 이력을 읽으므로, 이력이 전이와 같은 트랜잭션에 있다는 4.6 이 여기서 확인된다 · `store-console.spec.ts` 「counts only the moves into 정지, not the ones out of it」 (해제를 함께 세면 두 번 정지되고 두 번 풀린 스토어가 네 번짜리로 보인다) · 「tells 정지 해제 from 승인 by where it came from」 — 도착지가 둘 다 `ACTIVE` 라 출발지로만 갈린다 · `stores-page.spec.tsx` 「answers "how many times was this store suspended" before the rows」 · 「names the system when nobody signed the move, and says so when a reason is missing」 — 처리자에 외래키를 걸지 않았으므로 그 칸이 실제로 비는 줄이 있다 | 이력 기록 | [x] |
| F7 | 데모 구분 | `admin-console.spec.ts` 「marks a demo store so its numbers are not read as real ones」 · `stores-page.spec.tsx` 「marks a demo store without touching its status」 — 계정이 어떻게 만들어졌는가와 지금 영업할 수 있는가는 다른 축이라 배지와 상태가 함께 선다 · `store-console.spec.ts` 「is narrowed by the demo flag」 · `demo-containment.spec.ts` 「names the demo flag nowhere outside the authorization layer」 가 `admin-seller.service.ts` 를 이름과 이유까지 적어 허용 목록에 넣는다 — 여기서 데모는 권한 판정 조건이 아니라 **화면이 답해야 할 주제**이고, 스코프는 이 행이 데모인가에 답하지 않는다 | 데모 판매자 표시 | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **2장**: P1~P5. **P6 해당 없음**
- **3장 전 항목 적용** (A5 — 지표 집계 N+1)
- **4장 해당 없음**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 지표 집계가 무거움 | 일별 집계 캐시 검토. 시드 규모에서는 직접 집계로 충분 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-07 | 완료. 승인·정지(M04)와 수수료율(M12)은 이미 있었고 이 TASK 는 지표와 이력만 더했다. 이력의 처리자에 외래키를 걸었다가 **기존 이력 표 둘 다 그것이 없다**는 것을 알고 뗐다 — 기록을 남기는 일이 기록되는 일을 막아서는 안 된다 (D-257) |
