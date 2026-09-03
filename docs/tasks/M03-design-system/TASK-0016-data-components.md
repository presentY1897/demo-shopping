# TASK-0016: 데이터 표시 컴포넌트

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M03 디자인 시스템 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/data-components` |
| 선행 작업 | TASK-0015 |

## 1. 목적

목록·표·상태 표현 컴포넌트를 만든다. **로딩 / 빈 상태 / 에러**를 매번 새로 만들지 않게 규격을 정한다.

## 2. 범위

### 포함
- Table (정렬 헤더, 고정 헤더, **모바일 가로 스크롤 + 첫 열 고정**)
- TableToCards — 표를 세로 카드로 변환 (seller 주문 목록용)
- Pagination — **커서 기반**
- EmptyState, ErrorState, Skeleton
- ErrorBoundary
- InfiniteScroll 훅 (목록 화면용)
- Card, Grid (**밀도 × 브레이크포인트 매트릭스** 기반 열 수)
- 카드 내부는 **컨테이너 쿼리**로 자기 폭에 반응
- 금액·날짜 포맷터 (통화 정보 포함 값에서 포맷)

### 제외
- 상품 카드 등 도메인 컴포넌트 (M06)
- 차트 (M12 매출 대시보드에서 판단)

## 3. 요구사항

- [x] 목록 컴포넌트가 로딩·빈 상태·에러 세 상태를 모두 표현한다
- [x] Pagination 이 커서 기반으로 동작한다
- [x] Grid 열 수가 밀도와 뷰포트 조합에 따라 바뀐다
- [x] 좁은 화면에서 표가 가로 스크롤되고 첫 열이 고정된다
- [x] 카드가 자기 폭에 따라 내부 레이아웃을 바꾼다
- [x] 금액이 통화 정보로부터 포맷된다 (하드코딩 "원" 금지)

## 4. 설계

```
<DataList
  state={loading | empty | error | ready}
  ... />
```
네 상태를 컴포넌트가 강제한다. 사용하는 쪽에서 빈 상태 처리를 빠뜨릴 수 없게 한다.

**커서 기반 페이지네이션을 쓰는 이유**: 오프셋은 깊은 페이지에서 느려지고, 목록이 바뀌는 동안 중복·누락이 생긴다. 상품·주문 목록은 계속 변한다.

## 5. 구현 계획

1. 상태 컴포넌트 (Empty / Error / Skeleton / ErrorBoundary)
2. DataList 상태 규격
3. Table + 정렬
4. 커서 Pagination + InfiniteScroll 훅
5. Card, Grid (밀도 연동)
6. 포맷터 유틸

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 4상태 렌더 | `data-list.spec.tsx` — 네 상태를 각각 렌더하고 **나머지 셋이 없는지**까지 확인 | loading·empty·error·ready 모두 정상 | [x] `DataList` 의 `loading`·`empty`·`error` 는 기본값 없는 필수 prop 이라 빈 상태를 빠뜨리면 컴파일되지 않는다 |
| F1b | 스토리 | Storybook 스토리 작성 (TASK-0104 F4 이월분) | 4상태 스토리 존재 | [x] `data-list.stories.tsx` Loading·Empty·Error·Ready + FourStates·Switcher, `table.stories.tsx` FourStates |
| F2 | 커서 페이지네이션 | `pagination.spec.tsx` — 키셋 대역을 끝까지 왕복 | 중복·누락 0건 | [x] 5건 목록 전 페이지 순회 결과가 `01..05` 정확히 1회씩. `이전` 은 정확히 한 페이지 |
| F3 | 데이터 변동 중 이동 | 1페이지에서 **앞쪽에 행 삽입** 후 다음 페이지 | 중복 표시 없음 | [x] 삽입 후 2페이지 `04·05` — 1페이지와 교집합 0. 오프셋이었다면 `03` 이 다시 나온다 |
| F4 | 밀도 연동 | Chromium 실측, 밀도 3 × 뷰포트 3 | 열 수가 매트릭스와 일치 (`pages.md` 참조) | [x] 1:1/2/3 · 2:2/3/4 · 3:2/4/6 (360/768/1440px). CI 는 `test/grid-columns.spec.tsx` |
| F4b | 표 가로 스크롤 | 360px Chromium 실측, 8열 표 | 가로 스크롤, 첫 열 고정, 페이지 자체는 스크롤 안 됨 | [x] `document.scrollWidth 360 = clientWidth 360`, region `328 → 870`. `scrollLeft=400` 후 첫 열 `left 16px` 유지, 2열 `151 → -249` |
| F4c | 컨테이너 쿼리 | **같은 뷰포트(1440px)** 에서 1열·6열에 같은 카드 배치 | 폭에 맞게 내부 레이아웃 변화 | [x] 1열 카드 1408px → `flex-direction: row`, 썸네일 160px / 6열 카드 221px → `column`, 썸네일 187px |
| F5 | 금액 포맷 | `money.spec.ts` — KRW·USD·EUR·JPY | 각 통화 규칙대로 표시 | [x] `12000 KRW → ₩12,000` · `1250 USD → $12.50` · `12000 USD → $120.00`. 소수 자릿수는 `Intl` 이 통화에서 결정 |
| F6 | 에러 격리 | `error-boundary.spec.tsx` — 자식에서 의도적 예외 | ErrorBoundary 가 잡고 페이지 유지 | [x] 형제 노드가 남아 있는 것까지 확인. `resetKeys` 변경 시 자동 복구 |

**F4b 의 "페이지 자체는 스크롤 안 됨" 을 어떻게 보장했는가.** 오버플로는 어딘가에는 있어야 한다. 문서에 두면
표 하나가 넓어지는 순간 **모든 화면이 가로 스크롤바를 물려받는다.** 그래서 `overflow-x: auto` 를 `w-full` 래퍼가
갖는다. 래퍼는 부모보다 넓어질 수 없고, `<table>` 은 `min-width: 100%` 로 자연 폭까지 자란다. 셀은
`white-space: nowrap` 이다 — 줄바꿈을 허용하면 표가 넓어지는 대신 길어지고, 고정할 가로 스크롤 자체가 사라진다.

**`border-collapse: separate` 는 장식이 아니다.** `collapse` 면 테두리 소유자가 셀이 아니라 표라서, 고정된 셀이
자기 오른쪽 테두리 아래에서 빠져나간다. 간격 0의 separate 는 겉보기가 같고 테두리가 셀에 붙어 있는다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — M05 부터 적용. 단 포맷터·커서 로직은 단위 테스트 필수 → `money.spec.ts`(11) ·
  `date.spec.ts`(10) · `cursor-pagination.spec.ts`(11) 로 충족. 세 모듈은 순수 함수라 렌더 없이 입력 → 출력으로 검증
- **2장 화면 게이트**: P2·P3·P4·P5 적용
- **3~4장 해당 없음**

| # | 결과 |
| --- | --- |
| Q1 `pnpm typecheck` | error 0 |
| Q2 `pnpm lint` | error 0 · warning 0 |
| Q3 `pnpm build` | 앱 3개 성공 |
| Q4 `pnpm test` | 전 패키지 통과. `packages/ui` 402 → **618** (+216) |
| `pnpm format:check` | All matched files use Prettier code style |
| P2 접근성 | Chromium + axe-core 4.13, WCAG 2.1 AA, **밀도 3 × 뷰포트 3 전 조합에서 위반 0** (규칙 23종 통과). CI 는 `test/story-a11y.spec.tsx` 가 스토리 91 → **143개**에 axe 적용 |
| P3 반응형 | 360 / 768 / 1440 × 밀도 3 — `document.scrollWidth == clientWidth` 전 조합 |
| P4 키보드 | 표 정렬 헤더(Tab → Enter), Pagination(Tab → Enter·Space), 표 스크롤 region(`tabindex=0`), 재시도 버튼 — 전부 상호작용 테스트로 검증 |
| P5 상태 표현 | `DataList` 가 네 상태를 타입으로 강제 |

**추가한 CI 게이트 3종.** 스크래치패드 1회 측정은 회귀를 못 잡으므로, 브라우저에서 확인한 것 중 CI 로 막을 수
있는 것을 `packages/ui/test/` 로 옮겼다. 셋 다 **렌더된 DOM 에서 클래스를 읽어 실제 Tailwind 로 컴파일한 뒤
선언을 검증**한다 — 클래스 이름 문자열 비교가 아니다.

| 파일 | 막는 회귀 |
| --- | --- |
| `test/container-query.spec.tsx` | 카드의 레이아웃 전환이 `@container` 가 아니라 `@media` 로 바뀌는 것. 실제로 `@md/card:` → `md:` 로 되돌려 2건 실패를 확인했다 |
| `test/table-layout.spec.tsx` | `overflow-x: auto` · `position: sticky` · `inset-inline-start: 0` · z 순서 · `border-separate` 소실. `overflow-x-auto` 제거로 실패 확인 |
| `test/grid-columns.spec.tsx` | `Grid` 가 `--density-cols` 대신 고정 열 수를 쓰는 것. `grid-cols-2` 로 바꿔 실패 확인. 매트릭스 자체는 `pages.md` 의 숫자를 전사해 대조한다 |

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] 이 문서의 상태만 `완료` 로 바꿨다. `docs/tasks/README.md` 와 `M03-design-system/README.md` 는 병행 작업 중 충돌을 피하려고 **오케스트레이터가 갱신**한다 |
| D2 | 커서 페이지네이션 규약을 `docs/design/pages.md` 에 반영 | [x] 공통 규칙에 규약 표 추가. 공통 UI 컴포넌트 표에 이번 컴포넌트 12종과 포맷터 추가 |

**상태를 `완료` 로 바꾼 근거.** 열려 있는 항목은 D1 의 절반, 인덱스 2곳뿐이다. 이번 웨이브는 세 브랜치가 동시에
움직이고 있어 인덱스 파일은 오케스트레이터가 일괄 갱신한다 — 병행 작업에서 같은 파일을 세 브랜치가 각각
고치면 rebase 마다 충돌한다. 그 외 기준은 모두 충족했고, 미충족 항목은 위 표에 `[ ]` 로 남겼다.

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 커서 기반은 "3페이지로 점프"가 안 됨 | 상품 목록은 무한 스크롤, 콘솔 표는 이전/다음 이동으로 설계 |
| R2 | 컨테이너 쿼리 브라우저 지원 | 최신 브라우저는 모두 지원. 미지원 환경은 열 수 기반 폴백 |

## 8. 확정된 버전

**새로 추가한 의존성은 없다.** `pnpm-lock.yaml` 무변경 — 컨테이너 쿼리도, 커서 스택도, 에러 경계도 Tailwind v4
와 React 가 이미 가진 것으로 충분했다. `packages/ui/package.json` 변경은 `./format` export 한 줄이다.

| 도구 | 버전 |
| --- | --- |
| Node | 24.13.1 |
| pnpm | 9.15.9 |
| TypeScript | 6.0.3 |
| React / React DOM | 19.2.8 |
| Tailwind CSS | 4.3.3 |
| Vitest | 4.1.11 |
| Storybook | 10.6.0 |
| axe-core | 4.13.0 |
| postcss (테스트에서 CSS 파싱) | 8.5.26 |

컨테이너 쿼리는 **Tailwind v4 내장**이라 플러그인이 필요 없다. `@md/card:` 는 `@container card (width >= 28rem)`
로 컴파일되며, 그 값은 Tailwind 기본 `--container-*` 스케일에서 온다 (`tokens.css` 는 이 네임스페이스를 리셋하지
않는다).

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | 구현. 계획 대비 변경 4건 — (1) 5장 2번의 "DataList 상태 규격"을 **필수 prop 3개**로 구현해 빈 상태 누락이 컴파일 오류가 되게 했다, (2) `useInfiniteScroll` 에 `rootMargin` 을 두지 않았다 — 앱이 `'200px'` 을 넘기는 순간 하드코딩 길이 검사에 걸리므로, 프리페치 거리는 **센티넬을 어디에 두는가**로 표현한다, (3) 포맷터를 `@shopping/ui/format` 이라는 React 없는 진입점으로 분리했다, (4) 6.2 에 CI 게이트 3종을 추가했다 |
| 2026-09-03 | `Money` 타입을 `packages/ui` 에 두었다. 원래 자리는 `packages/shared` 지만 TASK-0011 이 그 패키지를 소유하고 있어 이번에는 옮기지 못했다. 커서 응답 타입(`CursorPage`)도 같다 — 서버가 이 형태를 만드는 TASK 에서 `packages/shared` 로 승격하고 여기서는 재수출한다 |
