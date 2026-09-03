# TASK-0014: 디자인 토큰 · 밀도 3단계

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M03 디자인 시스템 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/design-tokens` |
| 선행 작업 | **M01 완료** (원래 M02 로 적혀 있었으나 실제 의존은 M01 의 Tailwind 공통 프리셋뿐이다) |

## 1. 목적

색·타이포·간격·radius 를 토큰으로 정의하고, **밀도 3단계를 CSS 변수 세트 3벌**로 만든다. 이후 모든 컴포넌트가 토큰만 참조하게 한다.

## 2. 범위

### 포함
- 색 토큰 (중립 계열 중심, 시맨틱 색: primary / danger / success / muted)
- 타이포 스케일, 폰트 스택 (한글 우선)
- 간격·radius·shadow·border 토큰
- **밀도 3단계 변수 세트** — 간격 배율, 폰트 배율, 그리드 열 수, 컴포넌트 패딩
- **밀도 × 브레이크포인트 매트릭스** — 열 수와 배율은 뷰포트에 따라 달라진다
- **터치 타깃 하한** — 밀도 배율과 무관하게 인터랙티브 요소 최소 44×44px
- 밀도 컨텍스트 (`data-density="1|2|3"` 을 root 에 부여)
- 밀도 상태 관리 훅 (localStorage 저장, 서버 값 연동 자리)
- Tailwind 프리셋에 토큰 연결
- 토큰 확인용 프리뷰 페이지 — **개발 전용.** `apps/shop` 은 색인되는 유일한 앱이고(DECISIONS 1장)
  스와치 목록은 스토어프론트 페이지가 아니다. 공개용 컴포넌트 쇼케이스는 Storybook(TASK-0104)이 맡는다.
  라우트 자체는 모든 환경에서 컴파일·빌드되고 프로덕션에서만 404 를 응답하므로, 빌드에서 제외했을 때처럼
  아무도 모르게 썩지 않는다

### 제외
- 실제 컴포넌트 (TASK-0015)
- 다크 모드 (범위 외)

## 3. 요구사항

- [x] 하드코딩된 색·간격 값 없이 토큰만으로 스타일을 작성할 수 있다
- [x] `data-density` 값을 바꾸면 간격·폰트·그리드가 즉시 바뀐다
- [x] 세 앱이 같은 토큰을 공유하되 콘솔은 밀도 고정(2단계)이다
- [x] 열 수와 배율이 뷰포트에 따라 달라진다
- [x] 어떤 밀도에서도 버튼이 44px 미만이 되지 않는다
- [x] 새로고침해도 선택한 밀도가 유지된다

## 4. 설계

**밀도만으로 열 수를 정하면 안 된다.** 360px 에서 맥시멀 6열이면 카드 하나가 55px 라 성립하지 않는다. 열 수와 배율은 **밀도 × 브레이크포인트 2차원**이다.

구현된 값(`packages/config/tailwind/density.css`). 변수명은 `--grid-cols` 대신 `--density-cols` 를 썼다 —
Tailwind 4 의 `grid-cols-*` 유틸리티와 이름이 겹쳐 읽는 사람이 둘을 같은 것으로 오해한다.

```css
/* 모바일 기본 (~767) */
:root, [data-density='2'] { --space-unit: 4px;   --font-scale: 1;    --radius-scale: 1;    --density-cols: 2; }
[data-density='1']        { --space-unit: 5px;   --font-scale: 1.02; --radius-scale: 1.25; --density-cols: 1; }
[data-density='3']        { --space-unit: 3.5px; --font-scale: 0.98; --radius-scale: 0.75; --density-cols: 2; }

@media (min-width: 768px) {
  :root, [data-density='2'] { --space-unit: 4px; --font-scale: 1;    --density-cols: 3; }
  [data-density='1']        { --space-unit: 6px; --font-scale: 1.05; --density-cols: 2; }
  [data-density='3']        { --space-unit: 3px; --font-scale: 0.95; --density-cols: 4; }
}
@media (min-width: 1280px) {
  :root, [data-density='2'] { --density-cols: 4; }
  [data-density='1']        { --density-cols: 3; }
  [data-density='3']        { --density-cols: 6; }
}
```

`:root` 가 2단계를 함께 들고 있는 이유는 `data-density` 가 없는 페이지(에러 화면, 콘솔의 초기 렌더)도
완전한 토큰 세트를 갖게 하기 위해서다. `:root` 와 `[data-density='N']` 은 명시도가 같으므로(0-1-0)
**소스 순서**가 승자를 정한다 — 그래서 미디어 쿼리마다 세 단계를 전부 다시 적는다.

`--space-unit` 은 Tailwind 의 `--spacing` 에 그대로 연결된다. 즉 `p-4` 가
`calc(var(--space-unit) * 4)` 로 컴파일되므로 **간격 유틸리티 전체가 밀도를 따른다.**
`@theme inline` 을 쓴 것이 핵심이다 — 없으면 `:root` 에서 한 번 계산되어
중첩된 `data-density` 스코프(프리뷰 페이지의 3단계 비교 패널)가 조용히 무시된다.

모바일에서는 **세 단계의 배율 차이를 데스크톱보다 좁힌다.** 좁은 화면에서 미니멀의 넓은 여백은 낭비이고, 맥시멀의 축소 배율은 글자를 못 읽게 만든다.

**터치 타깃**: `--font-scale` 이 줄어도 인터랙티브 요소는 최소 44×44px 를 유지한다. 시각적으로 작아 보이더라도 패딩으로 터치 영역을 확보한다.

```css
--touch-min: 44px;   /* 밀도와 무관한 고정값 */

/* 하한은 컴포넌트가 기억하는 규칙이 아니라 토큰 자체의 성질이다 */
--spacing-control-sm: max(var(--touch-min), calc(var(--space-unit) * 8));
--spacing-control-md: max(var(--touch-min), calc(var(--space-unit) * 11));
--spacing-control-lg: max(var(--touch-min), calc(var(--space-unit) * 14));
```

시각적으로 더 작아야 하는 요소(아이콘 버튼·체크박스)는 `touch-target` 유틸리티로
히트 영역만 44px 로 넓힌다.

전체 반응형 전략은 `docs/design/pages.md` 참조.

| 단계 | 성격 | 레퍼런스 |
| --- | --- | --- |
| 1 미니멀 | 넓은 여백, 큰 이미지, 정보 최소 | SSENSE, 아페쎄 |
| 2 표준 | 균형 | 무신사, 29CM |
| 3 맥시멀 | 조밀, 정보 최대 | 쿠팡, 알리익스프레스 |

**정보의 표시 여부**는 토큰이 아니라 컴포넌트가 밀도 값을 읽어 결정한다. 토큰은 공간·크기만 담당한다.

## 5. 구현 계획

1. 색·타이포·간격 토큰 정의
2. 밀도 3단계 변수 세트
3. Tailwind 프리셋 연결
4. 밀도 컨텍스트·훅 (localStorage)
5. 토큰 프리뷰 페이지
6. 세 앱에 프리셋 적용, 콘솔은 밀도 고정

## 6. 완료 기준

### 6.1 기능

검증은 `pnpm dev` 로 띄운 세 앱을 **헤드리스 크로미움으로 실제 렌더**해 측정했다.
계산이 아니라 `getBoundingClientRect()` 와 `getComputedStyle()` 의 값이다.

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | 토큰 적용 | `/tokens` 프리뷰 페이지 | 색·타이포·간격 전 토큰 렌더 | 색 33 · 팔레트 26 · 타이포 10 · 간격 9 · radius 6 · shadow 5 · 컨트롤 4 렌더 | [x] |
| F2 | 밀도 전환 | 토글 클릭 후 계산값 측정 | 3단계 모두 간격·폰트·열 수 변화 | `--space-unit` 5/4/3.5px · `font-size` 16.32/16/15.68px · 열 1/2/2 (360px) | [x] |
| F3 | 지속성 | 밀도 변경 후 새로고침 | 선택값 유지 | 3 선택 → reload 후 `data-density="3"`, `localStorage="3"` (360·768·1440 전부) | [x] |
| F4 | 콘솔 고정 | seller/admin 접속 | 밀도 2단계 고정, 토글 없음 | 두 앱 모두 `data-density="2"` · `--space-unit: 4px` · `<button>` 0개 · 부트 스크립트 없음 | [x] |
| F5 | 하드코딩 금지 | `grep` 으로 hex·px·팔레트 검색 | 토큰 정의 파일 외 0건 | hex 0 · `oklch()`/`rgb()` 0 · 임의값 `[...px]` 0 · Tailwind 기본 팔레트 0 · 원시 팔레트 직접 사용 0 | [x] |
| F6 | 대비 | OKLCH → sRGB 변환 후 WCAG 비율 계산 | WCAG AA (4.5:1) 충족 | 텍스트 23쌍 최저 **5.47:1** (white on teal-500), 인터랙티브 외곽선 2쌍 최저 4.73:1 (기준 3:1) | [x] |
| F7 | 밀도 × 뷰포트 | 밀도 3 × 뷰포트 3 = 9조합 | 열 수가 매트릭스와 일치 | 360: 1/2/2 · 768: 2/3/4 · 1440: 3/4/6 — 9조합 전부 일치 | [x] |
| F8 | 모바일 맥시멀 | 360px 맥시멀 | 2열, 카드 폭 150px 이상 | 2열, 카드 폭 **159.0px** | [x] |
| F9 | 터치 타깃 | 9조합에서 페이지 내 최소 버튼 측정 | 44×44px 이상 | 9조합 전부 최소 **44.0 × 44.0px** (높이·너비 모두) | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — M05 부터 적용. 단 밀도 훅은 단위 테스트 필수
- **2장 화면 게이트**: P2(접근성)·P3(반응형) 적용. P1(LCP)·P5·P6 은 실제 화면부터
- **3~4장 해당 없음**

| # | 결과 |
| --- | --- |
| Q1 `pnpm typecheck` | error 0 |
| Q2 `pnpm lint` + `pnpm format:check` | error 0 / warning 0 |
| Q3 `pnpm build` | 4개 앱 전부 성공 |
| Q4 `pnpm test` | 219개 통과 (`packages/ui` 154 + `apps/api` 65) |
| Q5 | 면제. 밀도 로직·훅·부트 스크립트·토큰 CSS 에 154개 테스트 작성 |
| P2 접근성 | 프리뷰 페이지 대비 전 조합 AA, 토글은 `aria-pressed`, 아이콘 버튼은 `aria-label` |
| P3 반응형 | 360 / 768 / 1440px 실측, 레이아웃 깨짐 0건 |

**밀도 훅 테스트**(TASK 필수 항목): `packages/ui/src/density/` 에 순수 로직 47개 ·
스토어 13개 · 부트 스크립트 10개 · 프로바이더/훅 7개. 프로바이더 테스트에는
`renderToString` → 부트 스크립트 실행 → `hydrateRoot` 순서로 **하이드레이션 불일치가
없음을 `console.error` 호출 0회로 확인**하는 케이스가 포함된다.

### 6.3 문서

| # | 기준 | 결과 | 충족 |
| --- | --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | 이 문서는 `완료`. **인덱스 2곳은 오케스트레이터가 갱신한다** (이 작업의 소유권 밖) | [~] |
| D2 | 밀도 3단계 규격을 `docs/design/pages.md` 에 실제 값으로 반영 | 변수 표 · 밀도×뷰포트 실측 표 · 컨트롤 높이 표 추가 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 | 결과 |
| --- | --- | --- | --- |
| R1 | 밀도 전환 시 레이아웃이 깨지는 조합 | 9조합(밀도 3 × 뷰포트 3)을 Storybook 툴바로 매번 확인 | Storybook 은 TASK-0104. 그때까지는 `/tokens` 프리뷰의 3단계 비교 패널과 `test/density-tokens.spec.ts` 의 9조합 검증이 그 자리를 맡는다 |
| R3 | 2차원 매트릭스로 토큰 정의가 복잡해짐 | 매트릭스는 열 수·배율에만 적용한다. **표시 항목은 밀도 1차원으로 유지**해 조합 폭발을 막는다 | 유지. 토큰은 공간·크기만 담당하고 표시 여부는 컴포넌트가 밀도 1차원으로 정한다 |
| R4 | 매트릭스가 CSS 와 TypeScript 두 곳에 존재 | 이미지 `sizes` 계산 등 JS 가 열 수를 알아야 하므로 한 벌로 만들 수 없다 | `test/density-tokens.spec.ts` 가 `density.css` 를 실제로 파싱해 `DENSITY_GRID_COLUMNS` 와 대조한다. 어긋나면 CI 가 막는다 |

## 8. 확정된 버전

기존 스택은 그대로다. 이 TASK 가 **새로 추가한 것은 `packages/ui` 의 테스트 도구뿐**이며,
런타임 의존성은 하나도 늘지 않았다(React 는 peer).

| 패키지 | 버전 | 위치 · 용도 |
| --- | --- | --- |
| tailwindcss | 4.3.3 | 세 앱 (기존) |
| @tailwindcss/postcss | 4.3.3 | 세 앱 (기존) |
| next | 16.3.4 | 세 앱 (기존) |
| react / react-dom | 19.2.8 | `packages/ui` **peer + dev** (신규 선언) |
| typescript | 6.0.3 | 전역 (기존) |
| vitest | 4.1.11 | `packages/ui` dev (신규) |
| jsdom | 30.0.1 | `packages/ui` dev (신규) — 훅·부트 스크립트 테스트 |
| @testing-library/react | 16.3.3 | `packages/ui` dev (신규) |
| postcss | 8.5.26 | `packages/ui` dev (신규) — 토큰 CSS 파싱 테스트 |
| @types/react / @types/react-dom | 19.2.18 / 19.2.5 | `packages/ui` dev (신규) |
| @types/node | 24.13.3 | `packages/ui` dev (신규) |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | 완료. 토큰 CSS 2벌 + 밀도 3단계 × 뷰포트 3구간 매트릭스, `packages/ui` 밀도 스토어·프로바이더·부트 스크립트, shop 프리뷰 페이지(개발 전용), 콘솔 2단계 고정. 9조합 실측으로 열 수·44px 하한 확인 |
