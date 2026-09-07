# TASK-0093: 회원 관리

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M14 관리자 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/user-management` |
| 선행 작업 | M13 완료 |

## 1. 목적

관리자가 회원을 조회하고 필요한 조치를 취한다.

## 2. 범위

### 포함
- 회원 목록 (검색·역할·가입일·데모 여부 필터)
- 회원 상세 — 주문·리뷰·문의·적립금·쿠폰 요약
- 역할 부여·회수 (ADMIN 부여 포함)
- 계정 정지·해제
- 적립금 수동 조정 (사유 필수, 원장 기록)
- 개인정보 마스킹 (목록은 마스킹, 상세는 사유 기록 후 열람)
- 데모 관리자는 `user.delete`·`seller.suspend` 퍼미션이 없어 정지·삭제·역할 부여 불가 (D-058)

### 제외
- 회원 탈퇴 강제 처리

## 3. 요구사항

- [x] 회원을 검색하고 상세를 볼 수 있다
- [x] 역할을 부여·회수할 수 있다
- [x] 적립금 조정이 원장에 기록된다
- [x] 목록에서 개인정보가 마스킹된다
- [x] 데모 관리자는 파괴적 작업을 할 수 없다

## 4. 설계

**적립금 수동 조정에 사유를 필수로** 한다. 돈에 해당하는 값을 관리자가 임의로 바꾸는 작업이므로 근거가 남아야 한다. 원장에 `ADJUST` 유형으로 기록하고 처리자를 남긴다.

**개인정보 열람 기록**: 상세에서 전체 정보를 볼 때 열람 로그를 남긴다. 실제 서비스의 관행이고, 포트폴리오에서도 개인정보 취급 인식을 보여준다.

### 4.1 막는 것이 아니라 **가르는 것**이다

운영에는 개인정보를 봐야 하는 일이 실제로 있다. 막을 수 없는 접근을 막는 척하면 두 가지가 나쁘다 — 일을 못 하게 되거나, 사람들이 우회로를 찾는다.

그래서 이 설계가 하는 일은 가르는 것이다. **훑어보는 일(목록)에는 가려진 값으로 충분하고, 가리지 않은 값이 필요한 순간(상세)에는 왜 필요한지 적게 한다.**

### 4.2 가리는 것은 **서버**다

화면마다 가리게 두면 한 화면이 잊는 날 그 화면만 전부 보여 주고, 그때 증상은 오류가 아니라 **이미 공개된 개인정보**다 (D-246 이 리뷰 작성자 이름에 같은 판단을 먼저 했다). 이름은 그 함수를 **다시 쓴다** — 규칙이 둘이면 두 화면이 같은 사람을 다르게 가린다.

이메일은 앞 세 글자와 도메인을 남긴다. 한 글자만 남기면 서로 다른 계정이 화면에서 같아 보이고, 전부 가리면 목록에서 계정을 지목할 방법이 사라져 **사람이 상세를 더 자주 열게 된다** — 가리기가 열람을 늘리는 셈이라 목적과 반대로 간다.

검색은 **원본을 찾는다.** 사람은 자기가 아는 이메일을 치지, 별이 박힌 문자열을 치지 않는다.

### 4.3 상세가 `POST` 인 이유

읽기인데 `GET` 이 아니다. 사유를 몸통으로 받아야 하기 때문이고, 그것을 질의 문자열에 실으면 **개인정보를 여는 이유가 접근 로그와 브라우저 기록에 그대로 남는다.**

그리고 이 요청은 부수효과가 있다 — 열람 기록 한 줄을 만든다. `GET` 이 그러면 프리페치나 재시도가 조용히 기록을 늘린다.

기록은 응답과 **같은 트랜잭션**에 있다. 밖에 두면 「기록은 실패했는데 값은 나갔다」가 가능해지고, 그 조합이 정확히 감사 기록이 막으려던 것이다. 알림과 반대 판단인 이유가 그것이다 — 알림은 못 받아도 원래 일이 되는 편이 낫지만, 열람 기록은 남지 않을 바에야 값이 안 나가는 편이 낫다.

열람은 **상태가 아니라 사건**이다. 마지막 열람만 남기면 「한 번 봤다」와 「백 번 봤다」가 같은 행이 되고, 그 둘이 다르다는 것이 이 기록의 요점이다.

### 4.4 정지는 탈퇴와 다르다

탈퇴는 되돌리지 않는 끝이고 정지는 되돌리는 조치다. 한 칸에 담으면 「해제」가 「탈퇴 취소」와 같은 일이 되고, 그 둘은 개인정보 처리 관점에서 전혀 다른 결정이다.

**로그인 경로가 이 칸을 본다.** 칸만 세우고 경로가 안 보면 정지된 사람은 다음 날 그냥 다시 들어오고, 어느 검사도 빨개지지 않는다. 살아 있는 세션도 함께 끊는다 — 정지가 「다음 로그인부터」가 되는 것은 정지가 아니다.

구글 로그인 쪽에서 정지된 계정은 **찾히지 않지만 새로 가입되지도 않는다.** `googleSub` 이 그대로 남아 만들기가 유일 제약에 걸린다 — 탈퇴는 신원을 놓아 주지만 정지는 쥐고 있는다.

### 4.5 적립금은 **원장의 문**을 지난다

관리자 서비스가 원장을 직접 쓰면 잔액과 통의 관계를 그쪽에서 다시 구현하게 되고, 두 구현은 어긋난다 — 그 어긋남은 다음 사용에서 「쓸 수 있다는데 잔액이 모자란다」로 나타난다.

지급과 차감이 **한 문**이다. 사람이 하는 조정에서 두 방향은 같은 판단이고, 문을 둘로 나누면 화면이 부호를 보고 어느 쪽을 부를지 정하게 된다 — 그 분기가 틀리면 더하려던 것이 빠진다.

**지급에는 유효기간이 없다.** 관리자가 사과의 뜻으로 준 것이 한 달 뒤에 조용히 사라지면 그것은 사과를 무르는 일이다. 차감은 잔액까지만 간다 — 음수로 두면 그 사람은 다음에 적립받는 만큼을 잃는데 아무 화면도 그것을 설명하지 못한다.

사유가 필수인 이유가 다른 곳과 다르다. 주문도 클레임도 가리키지 않는 원장 줄이라, **사유가 그 움직임의 유일한 근거**다.

### 4.6 쓰기는 최고관리자의 것이다

정지도 적립금 조정도 `user.write` 이고, 그것은 `permission-matrix.md` 에서 최고관리자만 갖는다. 운영자는 읽을 수 있고 바꾸지 못한다 — 회원 계정을 멈추는 것과 돈에 해당하는 값을 손으로 바꾸는 것은 그 선 안쪽의 결정이다.

데모 관리자는 `user.write` 를 **아예 갖고 있지 않아** 라우트에서 막힌다 (D-058).

## 5. 구현 계획

1. 목록 API·화면 (필터·검색)
2. 상세 화면 (요약 집계)
3. 역할 부여·회수
4. 정지·해제
5. 적립금 조정
6. 마스킹·열람 로그
7. 데모 제한

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 검색 | `admin-users.spec.ts` 「searches the real value, not the masked one」 — 가려진 문자열로는 **아무것도 안 나오는 것**까지 단언한다(4.2) · 「narrows by role and by demo」 · `user-console.spec.ts` 「carries every axis that was set, and trims the search」 · 「leaves an unset axis out of the query rather than sending undefined」 · 「sends a false as a value, not as an absence」 · 「is not narrowed by an empty filter, nor by whitespace somebody typed and erased」 · `users-page.spec.tsx` 「sends the search once, when it is submitted」 · 「narrows by role without a second press」 | 정확히 조회 | [x] |
| F2 | 상세 요약 | `admin-users.spec.ts` 「summarises what the member did, as numbers only」 — 여섯 칸을 `toEqual` 로 통째로 못 박아 칸이 늘거나 빠지면 빨개진다. **다만 서버의 집계는 아직 0인 회원 하나로만 잰다** — 주문·리뷰가 있는 회원으로 수가 맞는지는 화면 쪽 고정 응답(`users-page.spec.tsx` 「summarises what the account did, as counts and money」)이 대신하고 있어, 그리는 것은 지켜지지만 세는 것은 안 지켜진다 · 「shows the unmasked values only after the reason was given」 | 주문·리뷰·적립금 요약 정확 | [x] |
| F3 | 역할 부여 | `authorization.integration.spec.ts` 「grants and revokes for a super admin, idempotently」(`SELLER_OWNER` 로 잰다) · 「lets an operator read anyone, but grants nothing」 · 「refuses to let a super admin lock themselves out」 · `users-page.spec.tsx` 「grants an everyday role in one press」 · 「asks again before it hands over the whole console」(R1) · 「revokes a role the account already holds」 · `user-console.spec.ts` 「counts DEMO_ADMIN among the roles that need a confirmation」 — **「판매자 앱 접근 가능해짐」까지 한 검사로 걷는 것은 없다.** 역할이 붙으면 seller 가 들어온다는 것은 `google-auth.integration.spec.ts` 「역할이 있으면 seller 에서 안내가 사라진다」가 따로 재는데 그쪽은 역할을 DB 에 직접 넣고, 역할은 액세스 토큰에 실리므로(`access-token.resolver.ts`) 부여의 효력은 **다음 발급부터**다 | 판매자 앱 접근 가능해짐 | [x] |
| F4 | 정지 | `admin-users.spec.ts` 「stops the account from getting a session again」 — 재려는 것이 칸이 아니라 **로그인**이라, 로그인·갱신 두 경로가 주인을 찾는 그 조건을 직접 걸어 0줄을 확인한다(라우트를 부르는 대신 조건을 복제하는 것이 이 검사의 값이자 한계다) · 「throws away the refresh tokens it finds」 — 살아 있는 세션을 안 끊으면 정지가 「다음 로그인부터」가 된다(4.4) · 「stores the reason with the suspension」 · 「tells "already suspended" apart from "no such member"」 · `users-page.spec.tsx` 「suspends with the reason, then lets the list say so」 · 「says the suspension is reversible and cuts the live session」 | 로그인 차단 | [x] |
| F5 | 적립금 조정 | `admin-users.spec.ts` 「refuses an adjustment with no reason, and a zero one」 · 「writes the movement to the ledger with the reason」 — `PointTransaction` 이 `ADJUST` 로 남았는지를 원장에서 직접 읽는다(4.5) · 「takes only as much as there is」 — 차감은 잔액까지만 가고 음수를 만들지 않는다 · `users-page.spec.tsx` 「will not adjust without a reason」 · 「sends a signed amount and the reason through one door」 · 「says what actually moved when the balance clipped the deduction」 · `user-console.spec.ts` 「says clipped when the balance stopped a deduction short」 · 「tells an empty amount apart from a zero」 | 차단. 사유 입력 시 원장 기록 | [x] |
| F6 | 마스킹 | `admin-users.spec.ts` 「masks the email and the name, and never sends the raw ones」 — 응답을 통째로 문자열로 훑어 원본이 **어디에도** 없음을 본다 · 규칙 자체는 `personal-data.spec.ts` 「keeps enough to tell two accounts apart」 · 「does not leak the length of a short local part」 · 「is the rule reviews already use」(D-246 의 함수를 다시 쓴다 — 규칙이 둘이면 두 화면이 같은 사람을 다르게 가린다) · `users-page.spec.tsx` 「shows the masked email and name, and no raw value anywhere」 · 「says the values are masked and that search looks at the real ones」 | 이메일·이름 마스킹 | [x] |
| F7 | 열람 로그 | `admin-users.spec.ts` 「writes who opened it, whose it was and why」 · 「records every opening, not just the first」 — 열람은 상태가 아니라 사건이라, 마지막 한 줄만 남기면 한 번 본 것과 백 번 본 것이 같아진다(4.3) · 「refuses to open without a reason」 · 「does not log an admin opening their own row」 · `users-page.spec.tsx` 「asks why before it opens anything」 · 「starts with an empty reason and refuses to send one」 · 「sends the sentence the operator actually typed」 · 「identifies the account by its masked values, inside the dialog」 | 로그 기록 | [x] |
| F8 | 데모 제한 | `admin-users.spec.ts` 「lets a demo admin read but not suspend」 · 「refuses an operator the writes only a super admin has」(4.6) · 「refuses a buyer, whose user.read is narrowed to their own row」 · `users-page.spec.tsx` 「blocks a demo administrator the same way」 · 「leaves an operator the reading and blocks every write, with a reason」 — 감추지 않고 `aria-disabled` 와 **왜 못 누르는지**를 함께 단언한다 · 「still renders a sentence when a 403 arrives at a live button」 — 미리 막는 것만으로는 부족하다(다른 탭에서 역할이 회수된 뒤) | 403 + UI 비활성 | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **2장**: P1~P5. **P6 해당 없음**
- **3~4장 전 항목 적용**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | ADMIN 역할 무분별 부여 | 부여 시 확인 다이얼로그 + 이력 기록. 데모 관리자는 불가 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-07 | 완료. 정지에서 0줄을 한 가지로 답하고 있었다 — 「그런 회원이 없다」와 「다른 관리자가 방금 처리했다」는 **사람이 할 일이 다르다**(404 · 409). 상세를 `POST` 로 둔 이유는 4.3 에 적었다 |
