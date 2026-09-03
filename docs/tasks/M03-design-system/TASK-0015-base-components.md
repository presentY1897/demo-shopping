# TASK-0015: 기본 컴포넌트

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M03 디자인 시스템 |
| 상태 | 승인됨 |
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

- [ ] 모든 컴포넌트가 키보드로 조작 가능하다
- [ ] Modal·Drawer 에서 포커스 트랩과 ESC 닫기가 동작한다
- [ ] 모든 컴포넌트가 하드코딩 값 없이 토큰만 쓴다
- [ ] 세 앱에서 동일하게 동작한다

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

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 컴포넌트 렌더 | 프리뷰 페이지 | 전 컴포넌트 · 전 variant 표시 | [ ] |
| F2 | 키보드 조작 | Tab·Enter·Space·ESC | 전 컴포넌트 조작 가능 | [ ] |
| F3 | 포커스 트랩 | Modal 열고 Tab 순회 | 포커스가 모달 밖으로 나가지 않음 | [ ] |
| F4 | 토큰 사용 | 스타일 코드 검색 | 하드코딩 값 0건 | [ ] |
| F5 | 앱 간 공유 | 세 앱에서 Button import | 동일 렌더 | [ ] |
| F6 | 밀도 반응 | 밀도 3단계 전환 | 패딩·폰트가 단계별로 변화 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — M05 부터 적용
- **2장 화면 게이트**: P2·P3·P4 적용
- **3~4장 해당 없음**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |
| D2 | 컴포넌트 목록을 `docs/design/pages.md` 에 반영 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | Radix 가 제공하지 않는 컴포넌트(Table, Badge 등) | 접근성 요구가 단순한 표시 컴포넌트라 직접 구현해도 문제없다 |

## 8. 확정된 버전

| 패키지 | 버전 |
| --- | --- |
| @radix-ui/react-* | |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
