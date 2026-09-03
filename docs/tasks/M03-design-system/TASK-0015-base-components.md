# TASK-0015: 기본 컴포넌트

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M03 디자인 시스템 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/base-components` |
| 선행 작업 | TASK-0014 |

## 1. 목적

세 앱이 공유하는 기본 UI 컴포넌트를 `packages/ui` 에 만든다. 앱마다 버튼을 다시 만드는 상황을 막는다.

## 2. 범위

### 포함
- Button, IconButton, Link
- Input, Textarea, Select, Checkbox, Radio, Switch
- Badge, Tag, Avatar, Divider
- Modal, Drawer, Tooltip, Popover
- Toast (알림 표시)
- Tabs, Accordion
- 각 컴포넌트가 토큰만 참조하도록 강제
- **Radix Primitives** 기반 — 접근성(포커스 트랩·ARIA·키보드)은 Radix, 스타일은 전부 우리 토큰으로

### 제외
- 데이터 표시 컴포넌트 (TASK-0016)
- 폼 검증 연동 (TASK-0017)
- 도메인 컴포넌트(상품 카드 등) — 해당 도메인 마일스톤

## 3. 요구사항

- [x] 모든 컴포넌트가 키보드로 조작 가능하다
- [x] Modal·Drawer 에서 포커스 트랩과 ESC 닫기가 동작한다
- [x] 모든 컴포넌트가 하드코딩 값 없이 토큰만 쓴다
- [x] 세 앱에서 동일하게 동작한다

## 4. 설계

**Radix Primitives 를 쓰고 스타일은 전부 직접 작성한다.** (D-056)

- Modal 포커스 트랩, Select 키보드 탐색, Popover 위치 계산 같은 접근성 요구를 직접 구현하면 품질이 안 나온다. Radix 가 이를 해결한다
- shadcn/ui 는 자체 CSS 변수 컨벤션(`--background`, `--foreground`)을 쓴다. 우리는 이미 밀도 3단계 토큰 체계가 있어 **토큰이 두 벌**이 된다. 결국 뜯어고쳐야 하므로 처음부터 우리 토큰으로 쓰는 편이 깔끔하다
- 컴포넌트는 `variant` / `size` prop 을 받고 값은 토큰에 매핑한다

## 5. 구현 계획

1. Radix Primitives 도입 및 토큰 연결
2. 폼 요소 (Input, Select, Checkbox, Radio, Switch)
3. 액션 요소 (Button, IconButton, Link)
4. 표시 요소 (Badge, Tag, Avatar, Divider)
5. 오버레이 (Modal, Drawer, Tooltip, Popover, Toast)
6. 구조 요소 (Tabs, Accordion)
7. 프리뷰 페이지에 전 컴포넌트 나열 (TASK-0104 에서 Storybook 으로 대체된다)

프리뷰 페이지는 **`packages/ui` 에 한 벌만 두고 세 앱이 같은 컴포넌트를 렌더한다.** 앱마다 갤러리를 따로 쓰면 세 화면이 조금씩 달라지고, F5("세 앱에서 동일 렌더")를 증명하지 못한다. 문구만 각 앱의 메시지 카탈로그에서 prop 으로 넣는다.

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | 컴포넌트 렌더 | 세 앱의 `/components` 프리뷰 | 전 컴포넌트 · 전 variant 표시 | 20종 · variant 를 `BUTTON_VARIANTS` 등 배열에서 순회해 전부 표시 | [x] |
| F2 | 키보드 조작 | Tab·Enter·Space·화살표·ESC | 전 컴포넌트 조작 가능 | jsdom 282 테스트 통과 + Chromium 에서 tabbable 48개 전부 Tab 도달 (앱 3개) | [x] |
| F3 | 포커스 트랩 | Modal 열고 Tab 순회 | 포커스가 모달 밖으로 나가지 않음 | Tab·Shift+Tab 30회 이탈 0 (앱 3개) · 배경은 `aria-hidden` 처리 | [x] |
| F4 | 토큰 사용 | grep 4종 + `component-tokens.spec.ts` | 하드코딩 값 0건 | hex 0 · 색 함수 0 · 임의 길이값 0 · 기본 팔레트 0 (`packages/ui` + 세 앱) | [x] |
| F5 | 앱 간 공유 | 세 앱에서 같은 갤러리 렌더 | 동일 렌더 | 동작 검증 48항목이 shop·seller·admin 에서 동일하게 통과. 차이는 accent 토큰뿐 | [x] |
| F6 | 밀도 반응 | 밀도 3단계 전환 | 패딩·폰트가 단계별로 변화 | `--space-unit` 6→4→3px · lg 버튼 84→56→44px · h1 31.5→30→28.5px · 페이지 높이 3128→2409→2127px | [x] |
| F7 | 터치 타깃 하한 | Chromium 실측 297개 | 44px 이상 | 최솟값 44.0px (앱 3 × 뷰포트 3 × 밀도 3 × 컨트롤 11) | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — M05 부터 적용
- **2장 화면 게이트**: P2·P3·P4 적용
- **3~4장 해당 없음**

| # | 기준 | 결과 |
| --- | --- | --- |
| Q1 | `pnpm typecheck` | error 0 |
| Q2 | `pnpm lint` | error 0 · warning 0 |
| Q3 | `pnpm build` | 전 앱 성공 |
| Q4 | `pnpm test` | 357 통과 (packages/ui 282 · apps/api 75) |
| P2 | Lighthouse Accessibility | **100 / 100** (shop · seller · admin) · axe-core 위반 0 (뷰포트 2 × 밀도 3) |
| P3 | 360 / 768 / 1440px | 가로 오버플로 0 (앱 3 × 밀도 3) |
| P4 | Tab 순회 | tabbable 48개 전부 도달, 미도달 0 |

UI 상호작용 목록(QUALITY-GATES Q5)에서 이번 TASK 에 해당하는 항목:

| # | 항목 | 결과 |
| --- | --- | --- |
| U1 | 조건부 렌더 4상태 | **해당 없음** — 데이터를 가져오는 컴포넌트가 없다 (TASK-0016) |
| U2 | 폼 검증 오류 표시 | **범위 밖** — TASK-0017. `invalid` prop 과 `aria-invalid` 만 준비 |
| U3 | 제출 중 중복 클릭 차단 | `Button.loading` — 클릭 3회 + Enter 에도 submit 1회 (jsdom · Chromium) |
| U4 | 밀도 3단계 렌더 | 3단계 각각에서 버튼·입력·체크박스·Select·Tabs·Modal 상호작용 통과 |
| U5 | 키보드만으로 조작 | 20종 전부. Select·RadioGroup·Tabs·Accordion 은 화살표 키까지 |
| U6 | 서버 오류 표시 | **해당 없음** — 서버를 호출하는 컴포넌트가 없다 |

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |
| D2 | 컴포넌트 목록을 `docs/design/pages.md` 에 반영 | [x] |
| D5 | 새 라이브러리 버전을 8장에 기록 | [x] |

D1 의 인덱스 2곳(`docs/tasks/README.md`, `docs/tasks/M03-design-system/README.md`)은 병행 작업 중 충돌을 막기 위해 **오케스트레이터가 별도 커밋으로 갱신**한다 — TASK-0007·TASK-0014 와 같은 방식이다.

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | Radix 가 제공하지 않는 컴포넌트(Table, Badge 등) | 접근성 요구가 단순한 표시 컴포넌트라 직접 구현해도 문제없다 |

## 8. 확정된 버전

| 패키지 | 버전 | 용도 |
| --- | --- | --- |
| @radix-ui/react-dialog | 1.1.23 | Modal · Drawer |
| @radix-ui/react-popover | 1.1.23 | Popover |
| @radix-ui/react-tooltip | 1.2.16 | Tooltip |
| @radix-ui/react-select | 2.3.7 | Select |
| @radix-ui/react-checkbox | 1.3.11 | Checkbox |
| @radix-ui/react-radio-group | 1.4.7 | RadioGroup · Radio |
| @radix-ui/react-switch | 1.3.7 | Switch |
| @radix-ui/react-toast | 1.2.23 | Toast |
| @radix-ui/react-tabs | 1.1.21 | Tabs |
| @radix-ui/react-accordion | 1.2.20 | Accordion |
| @radix-ui/react-avatar | 1.2.6 | Avatar |
| @testing-library/user-event | 14.6.7 | 실제 키·클릭 입력 (dev) |
| @testing-library/jest-dom | 7.0.1 | DOM 매처 (dev) |
| @testing-library/dom | 10.4.1 | 위 두 개의 peer (dev) |

`@radix-ui/react-separator` 는 **쓰지 않는다.** Divider 는 `role="separator"` 한 줄이라 직접 구현하는 편이 짧고, Radix 를 쓰면 정적인 구분선까지 클라이언트 컴포넌트가 된다 (7장 R1).

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | 완료. 기본 컴포넌트 20종을 Radix Primitives 위에 자체 토큰으로 구현. 세 앱에 개발 전용 `/components` 갤러리 추가. 하드코딩 검사·터치 하한 검사를 CI 테스트로 상시화(`component-tokens.spec.ts`·`touch-target.spec.ts`). `--color-overlay` 토큰 1개 추가. Q1~Q4 · format 통과, 테스트 357개, Lighthouse a11y 100 |
