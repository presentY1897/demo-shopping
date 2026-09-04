# TASK-0104: Storybook

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M03 디자인 시스템 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/storybook` |
| 선행 작업 | TASK-0015 |

## 1. 목적

`packages/ui` 컴포넌트를 Storybook 으로 문서화한다. **밀도 3단계 × 컴포넌트 조합을 토글하며 확인**할 수 있게 만드는 것이 이 프로젝트에서의 핵심 가치다.

## 2. 범위

### 포함
- Storybook 설정 (`packages/ui` 대상, Vite 기반)
- **글로벌 데코레이터** — 밀도 3단계를 툴바에서 전환
- 컴포넌트별 스토리 (기본 · 전체 variant · 상태별 · 엣지 케이스)
- 데이터 표시 컴포넌트의 4상태 스토리 (loading / empty / error / ready)
- 접근성 애드온 (a11y) 연동
- 정적 빌드 후 배포 (Vercel 프로젝트 또는 GitHub Pages)
- **디자인 토큰 문서 페이지** (D-206) — 아래 참조
- 앱 내 `/tokens` 프리뷰 페이지를 Storybook 으로 대체

### 제외
- 시각적 회귀 테스트(Chromatic 등) — 유료·설정 비용 대비 이득이 적다
- 도메인 컴포넌트(상품 카드 등) 스토리 — 해당 마일스톤에서 추가

### 디자인 토큰 문서 페이지 (D-206)

이 Storybook 은 컴포넌트만 담지 않는다. **디자인 기준 자체를 언제든 확인할 수 있는 문서**여야 한다. TASK-0014 가 `apps/shop` 의 `/tokens` 에 만든 내용을 Storybook 으로 옮긴다.

| 담을 것 | 출처 |
| --- | --- |
| 색 — 팔레트 · 시맨틱, 각 대비비 표시 | `packages/config/tailwind/tokens.css` |
| 타이포 스케일 · 폰트 스택 | 〃 |
| 간격 · radius · shadow | 〃 |
| **밀도 × 뷰포트 매트릭스** (3 × 3, `--space-unit`·`--font-scale`·`--density-cols`) | `packages/config/tailwind/density.css` |
| **컨트롤 높이 · 터치 타깃 44px 하한** | 〃 |

**값을 문서에 손으로 옮겨 적지 않는다.** CSS 변수를 런타임에 읽어 표를 그린다. 두 벌이 되면 반드시 어긋나고, 어긋난 순간 이 문서는 믿을 수 없어진다.

**순서**: Storybook 이 역할을 이어받은 것을 확인한 **뒤에** `/tokens` 를 제거한다. 반대로 하면 확인 수단이 없는 구간이 생긴다.

## 3. 요구사항

- [x] 툴바에서 밀도를 바꾸면 모든 스토리가 즉시 반영된다
- [x] 모든 기본 컴포넌트에 스토리가 있다
- [x] a11y 애드온이 위반 사항을 표시한다
- [x] **접근성 검사가 CI 에서 상시 실행된다** — 아래 참조
- [x] 배포된 URL 로 접근할 수 있다 — <https://presenty1897.github.io/demo-shopping/>
- [x] 앱 번들 크기에 영향을 주지 않는다
- [x] **디자인 토큰 문서 페이지에서 색·타이포·간격·밀도 매트릭스·터치 타깃을 확인할 수 있다**
- [x] **토큰 표의 값이 CSS 변수에서 런타임에 읽힌다** (문서에 값을 복제하지 않는다)
- [x] `apps/shop` 의 `/tokens` 가 제거되고 Storybook 이 그 역할을 대신한다

### 접근성 검사를 CI 로 (TASK-0015 에서 이월)

TASK-0015 는 Lighthouse Accessibility 100점과 axe-core 위반 0건을 측정했지만, **그 측정은 스크래치패드의 헤드리스 브라우저에서 1회 수행됐고 CI 에는 들어가지 않았다.** 즉 지금은 회귀를 잡아줄 장치가 없다 — 다음에 누가 `aria-label` 을 빼도 CI 는 초록이다.

Storybook 의 a11y 애드온을 **화면에 표시만 하는 용도로 끝내지 말고**, 스토리 전체에 대해 axe 를 돌려 위반 시 실패하는 경로를 CI 에 붙인다. `QUALITY-GATES.md` 2장 P2(Lighthouse Accessibility 90점 이상)를 사람이 매번 재지 않아도 되게 하는 것이 목적이다.

**구현 방식 (계획에서 구체화)**: Storybook test-runner(Playwright) 대신 **portable stories** 를 썼다.
`test/story-a11y.spec.tsx` 가 `composeStories` 로 모든 스토리를 합성해 렌더하고 `axe.run(document.body, …)` 을 돌린다.

| 이유 | |
| --- | --- |
| **CI 파일을 건드리지 않는다** | 이미 있는 `packages/ui` 의 Vitest 스위트 안에서 돌므로 `pnpm test` 가 그대로 게이트가 된다. `.github/workflows/ci.yml` 에 잡·브라우저 설치를 추가할 필요가 없다 |
| **같은 규칙 집합** | 애드온과 이 검사가 `stories/support/a11y.ts` 하나를 공유한다. 따로 두면 언젠가 어긋나고, 어긋난 쪽은 조용한 게이트다 |
| **포털을 포함한다** | 컨테이너가 아니라 `document.body` 를 스캔하므로 modal·drawer·tooltip·popover·toast 가 빠지지 않는다 |

**jsdom 이 답할 수 없는 것**: 레이아웃과 CSS 가 없어 `color-contrast` 는 pass/fail 이 아니라 "incomplete" 로 돌아온다. 이 검사에서는 그 규칙만 끄고, 대비는 `test/color-tokens.spec.ts` 가 OKLCH 값을 변환해 4.5:1 미만이면 실패시키는 것으로 계속 강제한다(브라우저의 애드온 패널에서는 그대로 동작한다).

## 4. 설계

```
글로벌 데코레이터: document.documentElement.setAttribute('data-density', globals.density)
툴바 → 밀도 1 / 2 / 3 전환
```

밀도는 래퍼 `<div>` 가 아니라 **`<html>` 에 쓴다.** 오버레이 계열은 포털로 `<body>` 에 렌더되므로 래퍼에 쓰면
정작 밀도에서 깨지기 쉬운 컴포넌트가 페이지 밀도 그대로 남는다. 앱이 하는 것과 같은 방식이기도 하다.

**Storybook 을 쓰는 이유**: 앱 내 프리뷰 페이지로도 컴포넌트를 나열할 수는 있다. 하지만 이 프로젝트는 **같은 컴포넌트가 밀도 3단계로 달라지는 것**이 특징이고, controls 로 props 를 바꿔가며 조합을 확인하는 데는 Storybook 이 확실히 낫다. 배포하면 포트폴리오 자산도 된다.

**비용**: 설정·유지와 배포 대상 하나 추가. 스토리를 안 쓰면 금방 낡으므로, 새 컴포넌트를 만들 때 스토리를 함께 쓰는 것을 M03 이후 컴포넌트 TASK 의 완료 기준에 넣는다.

### 스토리를 `src` 밖에 두는 이유 (계획에서 추가)

스토리는 `packages/ui/stories/` 에 있고 `packages/ui/src/` 에 없다. 공통 프리셋이
`@source "../../ui/src"` 로 그 트리를 스캔하므로, `src` 안에 스토리를 두면 **스토리에만 쓰인 유틸리티가
앱 3개의 CSS 에 컴파일되어 들어간다.** F7(번들 영향 0)을 기억이 아니라 구조로 보장하기 위한 배치다.
Storybook 쪽은 `.storybook/preview.css` 가 `@source '../stories'` 로 따로 스캔한다.

### 토큰 문서가 값을 읽는 방법 (계획에서 구체화)

| 무엇 | 어떻게 |
| --- | --- |
| 토큰 **이름** | `document.styleSheets` 를 재귀로 훑어 `--` 로 시작하는 선언을 수집 (`stories/support/css-variables.ts`) |
| 색 **값** | 프로브 요소에 `color: var(--token)` 을 걸고 `getComputedStyle` 로 읽음 |
| 색 **대비비** | 1×1 캔버스에 그 색을 칠하고 픽셀을 읽어 WCAG 상대휘도 계산 (`stories/support/color.ts`) |
| 시맨틱/팔레트 **구분** | 값이 다른 색 토큰을 가리키면 시맨틱. `currentColor`·`inherit` 는 상속 색이 다른 프로브 두 개에서 다른 답을 내므로 자동으로 걸러진다 |
| **길이** | 토큰을 실제 속성에 대입한 박스를 `getBoundingClientRect` 로 측정. 커스텀 속성을 그대로 읽으면 `max(44px, calc(4px * 11))` 이라는 선언이 나오지 숫자가 나오지 않는다 |
| **밀도 × 뷰포트 9칸** | 각 밴드 폭으로 만든 화면 밖 `<iframe>` 안에서 측정 (`stories/support/viewport-probe.ts`). 미디어 쿼리는 뷰포트에만 답하므로 현재 창에서는 나머지 여섯 칸을 만들 수 없다 |

프레임 안에서는 밀도를 그 문서의 `<html>` 에 건다. `@theme inline` 블록의 토큰(`--text-base`,
`--spacing-control-*`)은 Tailwind 가 `:root` 에 내보내므로 **중첩 스코프에서 재면 세 열이 전부 같은 값이 된다.**

## 5. 구현 계획

1. Storybook 설치·설정 (`packages/ui`)
2. 디자인 토큰·글로벌 스타일 연결
3. 밀도 전환 데코레이터
4. 기본 컴포넌트 스토리 작성
5. a11y 애드온 + **스토리 전체 axe 검사를 `pnpm test` 에 편입**
6. 정적 빌드 (배포 대상은 사용자 결정)
7. 디자인 토큰 문서 페이지 작성 (CSS 변수 런타임 조회)
8. Storybook 이 역할을 대신하는 것을 확인한 뒤 `apps/shop` 의 `/tokens` 제거

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 기동 | `pnpm storybook` | 로컬에서 실행 | [x] 6006 + `PORT_OFFSET` |
| F2 | 밀도 전환 | 툴바에서 3단계 전환 | 전 스토리에 즉시 반영 | [x] `data-density` 1/2/3 → Button md 66.0 / 44.0 / 44.0px |
| F3 | 스토리 커버 | 컴포넌트 목록 대조 | 기본 컴포넌트 100% 스토리 존재 | [x] `test/story-coverage.spec.ts` 가 공개 export 27개를 CI 에서 강제 |
| F4 | 4상태 | DataList·Table 스토리 | loading·empty·error·ready 전부 | [x] **TASK-0016 이 채웠다.** `data-list.stories.tsx` 가 `Ready`·`Loading`·`Empty`·`Error` 를 각각 두고 `FourStates` 로 나란히 보여 준다. `table.stories.tsx` 도 `FourStates` 를 갖는다 |
| F5 | a11y | 애드온 패널 + CI | 위반 0건 | [x] 스토리 91개 axe 위반 0 (`test/story-a11y.spec.tsx`) |
| F6 | 배포 | 배포 URL 접속 | 정상 렌더 | [x] <https://presenty1897.github.io/demo-shopping/> **200**, `<title>storybook - Storybook</title>`. `iframe.html` 과 `assets/iframe-*.js` 도 200 — 서브패스에서 자산까지 로드된다. 자격증명 없는 쪽에서 받았으므로 공개 접근이 증명된다 |
| F7 | 번들 영향 | 앱 빌드 크기 비교 | 증가 0 | [x] `.next/static` admin 761,127B → 761,127B (Popover 수정 전 기준으로 동일) |

**F6 의 배포 대상을 GitHub Pages 로 정한 이유.** Vercel 에도 올려 두었으나, 배포마다 주소가
바뀌고 배포별 URL 은 기본적으로 로그인 뒤에 있다. 이 저장소를 읽는 사람 대부분은 소유자가
아니므로 **열리지 않는 주소는 없는 것과 같다**(D-211 과 같은 판단). Pages 는 공개가 기본이고
주소가 저장소 이름에 묶여 고정이다. Storybook 이 상대 경로로 빌드하는 것을 확인했으므로
`/demo-shopping/` 서브패스에서도 그대로 동작한다 — `grep -c 'src="/' storybook-static/*.html`
이 0 이다.

**F4 는 이월 후 충족됐다.** 이 TASK 시점에는 `packages/ui` 에 `DataList` 도 `Table` 도 없었다.
4상태를 흉내 낸 가짜 스토리를 두면 아무것도 검증하지 않으면서 충족된 것처럼 보이므로, 해당
컴포넌트를 만드는 TASK 로 이월했다. **TASK-0016(데이터 표시 컴포넌트)이 컴포넌트와 스토리를
함께 만들면서 채웠다** — 이월이 실제로 회수된 사례다.

상태가 있는 컴포넌트에 대해서는 지금도 상태별 스토리가 있다 — `Button`(idle/disabled/loading),
`Input`·`Textarea`·`Select`(invalid/disabled/read-only), `Select`(옵션 0개), `Avatar`(이미지 실패 시 폴백).

**F7 측정 방법.** `.next/static` 을 바이트로 비교했다. `apps/seller`·`apps/admin` 은 `+97B` 가 나왔는데,
그 전부가 아래 8장의 `Popover` 접근성 수정(`useId` + `aria-labelledby`)에서 나온 것이다 — 그 수정만
되돌리고 다시 빌드하면 `761,127B` 로 기준값과 정확히 같아진다. **Storybook 자체의 기여는 0바이트다.**
CSS 도 바이트 단위로 동일하고, 스토리에만 쓰인 유틸리티(`min-w-120`·`overflow-x-auto`)는 Storybook 의
CSS 에만 있고 앱 CSS 세 개 어디에도 없다. `apps/shop` 은 `/tokens` 제거로 `787,752B → 777,234B` 로 줄었다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — 스토리는 커버리지 대상 외
- **2장 화면 게이트 해당 없음** — 개발자 도구이며 사용자 대상 화면이 아니다.
  단, P2(접근성)는 면제가 아니라 **강화**됐다: 스토리 전체 axe 검사가 `pnpm test` 안에 들어가
  세 앱의 컴포넌트가 CI 에서 상시 검사된다
- **3~4장 해당 없음**

| # | 결과 |
| --- | --- |
| Q1 `pnpm typecheck` | error 0 |
| Q2 `pnpm lint` + `pnpm format:check` | error 0 · warning 0 |
| Q3 `pnpm build` | 전 앱 성공 |
| Q4 `pnpm test` | 711 passed (기준 591 → +120: a11y 91 · 커버리지 29) |

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] 상태 갱신 · 인덱스는 오케스트레이터 |
| 추가 | 새 컴포넌트에 스토리를 함께 작성하는 규칙을 `CLAUDE.md` 에 기재 | [x] 6장 |
| 추가 | `README.md` 에 Storybook 절 · 포트 표 갱신 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 스토리가 낡아 실제와 어긋남 | 컴포넌트 TASK 의 완료 기준에 스토리 작성을 포함(`CLAUDE.md` 6장). `test/story-coverage.spec.ts` 가 빠진 컴포넌트를 CI 에서 잡는다 |
| R2 | 배포 대상이 하나 더 늘어 관리 부담 | 정적 빌드라 배포 비용이 거의 없다. 실패해도 서비스에 영향 없음 |
| R3 | 모노레포에서 Storybook 이 앱 설정과 충돌 | `packages/ui` 안에 격리하고 앱 설정을 참조하지 않는다 |
| **R4** | **배포가 사용자 계정에 막힌다** | **해소됨.** 사용자가 Pages 소스를 Actions 로 설정했으나 저장소에 배포 워크플로가 없어 한 번도 배포되지 않았다(`status: null`, URL 404). `.github/workflows/storybook.yml` 을 추가해 `main` push 시 자동 배포한다. 주소는 <https://presenty1897.github.io/demo-shopping/> 로 고정이다 |
| **R5** | **jsdom 에서 `color-contrast` 를 잴 수 없다** | 그 규칙만 끄고 `test/color-tokens.spec.ts` 가 계속 강제한다. 브라우저의 애드온 패널에서는 정상 동작 |

## 8. 확정된 버전

| 패키지 | 버전 |
| --- | --- |
| storybook | 10.6.0 |
| @storybook/react-vite | 10.6.0 |
| @storybook/addon-a11y | 10.6.0 |
| @storybook/addon-docs | 10.6.0 |
| @tailwindcss/vite | 4.3.3 |
| tailwindcss | 4.3.3 |
| vite | 8.2.2 |
| @vitejs/plugin-react | 6.1.1 |
| axe-core | 4.13.0 |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | 2장에 디자인 토큰 문서 페이지(D-206)와 접근성 CI 절 추가, 승인 |
| 2026-09-03 | 구현. 계획 대비 변경 4건을 문서에 반영 — (1) a11y CI 를 test-runner 가 아니라 portable stories + Vitest 로 구현(`ci.yml` 무수정), (2) 스토리를 `packages/ui/stories/` 에 배치(F7 을 구조로 보장), (3) F4 는 대상 컴포넌트 부재로 이월, (4) F6 은 계정·저장소 설정이 필요해 정적 빌드까지 |
| 2026-09-03 | 2장 표의 "팔레트 26"을 수치 없는 표현으로 정정. 런타임 문서가 실제로 센 값은 **29**(구조 키워드 `transparent`·`currentColor`·`inherit` 3개 제외). 문서에 숫자를 적어 두면 어긋난다는 D-206 의 논지가 이 TASK 문서 자신에게서 먼저 확인됐다 |
| 2026-09-03 | a11y 게이트가 첫 실행에서 `Popover` 의 실제 결함(`aria-dialog-name` — 제목 없는 패널에 접근 가능한 이름이 없음)을 잡아 컴포넌트를 함께 수정. `title` 과 `aria-label` 을 유니온으로 묶어 컴파일러가 이름을 요구하게 했다 |
