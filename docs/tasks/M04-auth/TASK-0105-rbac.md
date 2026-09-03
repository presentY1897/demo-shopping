# TASK-0105: 퍼미션 기반 권한 체계 (RBAC)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 승인됨 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/rbac` |
| 선행 작업 | TASK-0020 |

## 1. 목적

권한을 **퍼미션 단위**로 두고 역할에 매핑한다. 데모 계정 제한이 별도 장치가 아니라 **권한 체계의 일부**로 표현되게 하는 것이 핵심이다.

## 2. 범위

### 포함
- 퍼미션 상수 정의 (`packages/shared`)
- 역할 → 퍼미션 매핑 (코드 상수)
- `@RequirePermission()` 가드 — API 전 엔드포인트 적용
- **리소스 스코프 검사** — 퍼미션만으로 부족한 "자기 것만" 조건
- **데모 리소스 조건** — 데모 관리자는 데모 계정이 만든 데이터만 처리
- 프론트 권한 훅 — 버튼 비활성 + 사유 툴팁
- 역할 부여·회수 API (관리자)
- 권한 매트릭스 문서 자동 생성

### 제외
- 역할을 DB 에서 편집하는 화면 — 코드 상수로 충분하다
- 판매자 직원 계정 (범위 밖. `SELLER_OWNER` 라는 이름으로 확장 여지만 남긴다)

## 3. 요구사항

- [ ] 권한 없는 호출이 403 으로 차단된다
- [ ] 데모 관리자가 실계정·시드 데이터를 수정할 수 없다
- [ ] 데모 관리자가 **데모 계정이 만든 데이터는 처리할 수 있다**
- [ ] 프론트에서 권한 없는 버튼이 비활성 + 사유가 표시된다
- [ ] `isDemo` 분기가 비즈니스 로직에 흩어지지 않는다

## 4. 설계

### 퍼미션

동사는 `read / write / delete / approve` 로 통일한다.

```
catalog.read      catalog.write     catalog.delete
product.read      product.write     product.delete
order.read        order.write
claim.read        claim.handle
coupon.read       coupon.write      coupon.delete
settlement.read   settlement.approve   settlement.pay
user.read         user.write        user.delete
seller.read       seller.approve    seller.suspend
demo.manage
```

### 역할

| 역할 | 퍼미션 |
| --- | --- |
| `BUYER` | 자기 데이터 (스코프로 제한) |
| `SELLER_OWNER` | 자기 스토어의 product·order·claim·coupon·settlement `read/write` |
| `ADMIN_OPERATOR` | 전체 read + catalog/product/coupon write + claim.handle + seller.approve |
| `ADMIN_SUPER` | 전부 (delete·settlement.pay·user.delete 포함) |
| `DEMO_ADMIN` | `ADMIN_OPERATOR` − 없음, **단 리소스 조건이 붙는다** (아래) |

`DEMO_BUYER` / `DEMO_SELLER` 는 만들지 않는다. 소유권 스코프로 이미 제한되므로 일반 역할과 같다.

### 리소스 스코프 — 퍼미션만으로 부족한 부분

퍼미션은 "무엇을 할 수 있나"만 답한다. "누구 것에"는 별도 조건이다.

| 스코프 | 의미 |
| --- | --- |
| `own` | 자기가 소유한 리소스만 (판매자 → 자기 스토어, 구매자 → 자기 주문) |
| `demo` | **데모 계정이 만든 리소스만** |
| `any` | 전부 |

```
SELLER_OWNER  product.write:own
ADMIN_OPERATOR product.write:any
DEMO_ADMIN    product.write:demo      ← 시드·실계정 상품은 못 건드린다
              seller.approve:demo     ← 데모 판매자의 신청만 승인 가능
```

**이 설계의 핵심**: 데모 제한이 `if (user.isDemo) throw` 같은 분기가 아니라 **스코프 값 하나**로 표현된다. 로직에 흩어지지 않는다.

### 데모끼리는 서로 처리할 수 있다

```
판매자 데모 A 가 입점 신청  →  관리자 데모 B 가 승인 가능
데모 구매자가 반품 신청     →  관리자 데모가 개입 가능
```

`demo` 스코프의 목적은 **실계정 보호**이지 데모 간 격리가 아니다. 데모끼리 열어야 관리자 콘솔이 조회만 되는 껍데기가 되지 않는다.

### 프론트

권한 없는 버튼은 **숨기지 않고 비활성 + 사유 툴팁**으로 보여준다. 기능이 있다는 것을 알리는 게 데모의 목적이다.

```tsx
<Button disabled={!can('user.delete')} title={reason('user.delete')}>
```

## 5. 구현 계획

1. 퍼미션 상수·역할 매핑 정의 (`packages/shared`)
2. `TASK-0020` 의 `UserRole` 을 새 역할 체계로 조정
3. `@RequirePermission()` 가드
4. 리소스 스코프 검사 (own / demo / any)
5. 프론트 권한 훅 + 비활성 UI
6. 역할 부여·회수 API
7. 권한 매트릭스 문서 생성 스크립트
8. 전 엔드포인트에 퍼미션 부여 확인

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 퍼미션 차단 | `BUYER` 로 `product.write` 호출 | 403 | [ ] |
| F2 | own 스코프 | 판매자 A 가 판매자 B 상품 수정 | 403 | [ ] |
| F3 | demo 스코프 — 차단 | 데모 관리자가 시드 카테고리 삭제 시도 | 403 | [ ] |
| F4 | demo 스코프 — 허용 | 데모 관리자가 **데모 판매자 신청 승인** | 성공 | [ ] |
| F5 | 데모 상호작용 | 판매자 데모 신청 → 관리자 데모 승인 | 전 과정 성공 | [ ] |
| F6 | 프론트 표시 | 데모 관리자 화면 | 권한 없는 버튼 비활성 + 사유 툴팁 | [ ] |
| F7 | 누락 방지 | 전 엔드포인트 검사 스크립트 | 퍼미션 미지정 0건 | [ ] |
| F8 | isDemo 분기 없음 | 비즈니스 로직 `grep isDemo` | 권한 계층 밖 0건 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5 강화** — 퍼미션·스코프 판정 로직은 **분기 커버리지 100%**. 권한은 틀리면 데이터가 새거나 잠긴다
- **2장**: 권한 훅 관련 U1·U5 적용
- **3장 전 항목 적용** (A3·A4 가 이 TASK 의 중점)
- **4장**: S1·S3 적용

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |
| D2 | 역할 × 퍼미션 매트릭스를 `docs/design/erd.md` 1장에 반영 | [ ] |
| D3 | 역할 × 퍼미션 매트릭스가 `DECISIONS.md` 와 일치하는지 확인 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 퍼미션 부여를 빠뜨린 엔드포인트가 무방비로 열림 | **기본 거부**로 설계한다. 퍼미션이 지정되지 않은 엔드포인트는 접근 불가. F7 로 검증 |
| R2 | 스코프 검사가 각 서비스에 흩어짐 | 스코프 판정을 공통 유틸 하나로 모으고 서비스는 호출만 한다 |
| R3 | 역할이 늘어 관리가 복잡 | 5개로 시작한다. 필요할 때만 추가하고 매트릭스 문서를 자동 생성해 한눈에 본다 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
