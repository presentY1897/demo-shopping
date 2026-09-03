# TASK-0017: 폼 시스템

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M03 디자인 시스템 |
| 상태 | 승인됨 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/form-system` |
| 선행 작업 | TASK-0015 |

## 1. 목적

zod 스키마 하나로 클라이언트 검증과 서버 검증을 공유하고, 에러 표시 방식을 통일한다. 상품 등록·주문서·관리자 설정 등 폼이 많은 화면의 기반이 된다.

## 2. 범위

### 포함
- `packages/shared` 의 zod 스키마를 폼에 연결하는 어댑터
- 필드 단위 에러 표시 규약 (위치, 색, aria-describedby)
- 서버 에러(400 응답의 `details`)를 필드에 매핑
- 제출 중 상태 (중복 제출 차단)
- **동적 폼 생성기** — 스키마 정의로부터 입력 필드를 생성 (M05 속성 폼의 기반)
- 확인 다이얼로그 규약 (파괴적 작업)

### 제외
- 실제 도메인 폼 (각 도메인 마일스톤)
- 파일 업로드 위젯 (M05)

## 3. 요구사항

- [ ] 같은 zod 스키마로 클라이언트·서버가 검증한다
- [ ] 서버 검증 오류가 해당 필드에 표시된다
- [ ] 제출 중 중복 클릭이 차단된다
- [ ] 스크린리더가 에러를 읽을 수 있다
- [ ] 필드 정의 배열로부터 폼이 생성된다

## 4. 설계

```
packages/shared/schemas/*.ts   ← 단일 출처
        ├─→ apps/*  (@shopping/ui/form 의 useForm)
        └─→ apps/api (parseInput — 같은 zod 스키마)
```

### 4.1 폼 라이브러리 선정 — 도입하지 않는다

**결론: 폼 라이브러리를 도입하지 않고 `packages/ui/src/form` 에 직접 만든다.**

`packages/ui` 는 "스스로 쓸 수 없는 것만 의존한다"는 규칙으로 운영해 왔다 — 접근성이 어려운
동작(포커스 트랩·리스트박스 탐색·로빙 탭인덱스)은 Radix 에 맡기고, 여섯 줄이면 되는 클래스 결합은
`clsx` 대신 `lib/cx.ts` 로 직접 썼다. 폼도 같은 기준으로 판단했다.

| 후보 | 판단 | 이유 |
| --- | --- | --- |
| **직접 구현** | **채택** | 이 저장소의 입력 컴포넌트 6종 중 4종(`Select`·`Checkbox`·`RadioGroup`·`Switch`)이 **Radix 기반 제어 컴포넌트**다. 라이브러리가 주는 값은 대부분 "비제어 입력을 ref 로 모아 리렌더를 줄이는 것"인데, 그 4종은 어느 라이브러리에서도 제어 어댑터를 거쳐야 하므로 이득이 사라진다. 이 TASK 가 실제로 해결해야 하는 것 — 암묵적 제출 차단, `details` → 필드 매핑, 동적 생성기, 확인 다이얼로그 — 은 **어떤 라이브러리도 주지 않는다** |
| react-hook-form + @hookform/resolvers | 탈락 | 런타임 의존 2개. 핵심인 `register` 비제어 경로가 `Input`·`Textarea` 2종에만 닿고 나머지는 전부 `<Controller>` 로 감싸야 한다. 즉 얻는 것은 `useState` 대체뿐인데, 그 대가로 앱 3개가 리졸버 호환(zod 4)까지 함께 짊어진다. 실제로 필요해지는 지점은 `useFieldArray` 가 값을 하는 M05 Variant 표(TASK-0114)이며, **그때 그 화면에서 도입 여부를 다시 판단**한다 — 지금 넣으면 근거 없이 앱 전체의 의존이 된다 |
| TanStack Form | 탈락 | 제어 우선이라 Radix 와는 잘 맞지만, 어댑터·검증·구독 API 가 커서 학습 비용이 자체 구현(약 400줄)을 넘는다. 폼 상태 자체는 이 프로젝트에서 어려운 부분이 아니다 |
| Formik | 탈락 | 유지보수 속도가 느리고 React 19 대응이 확인되지 않았다. 리렌더 특성도 자체 구현 대비 이점이 없다 |
| React 19 `useActionState` + `<form action>` | 탈락 | 서버 액션 전제의 모델이다. 이 저장소의 프론트는 **NestJS REST API 를 fetch 로 부르고**(D-009 분리 배포), 서버 액션을 쓰지 않기로 되어 있어 모델이 맞지 않는다. 다만 "제출은 폼 이벤트가 소유한다"는 관점은 4.2 에서 그대로 가져왔다 |
| 네이티브 제약 검증(`required`·`pattern`) | 탈락 | 메시지 문구·위치·다국어를 브라우저가 결정하고 zod 스키마와 규칙이 두 벌이 된다. `<form noValidate>` 로 끈다 |

**재검토 조건**: TASK-0114 의 Variant 표(100행)에서 행 단위 렌더 분리만으로 입력 지연이 해결되지
않으면 react-hook-form 을 다시 검토한다. 그 판단은 그 TASK 가 한다.

### 4.2 제출 가드는 폼이 소유한다

`Button.loading` 은 `aria-disabled` + `onClick` 가드로 **클릭 경로**를 막는다(TASK-0015). 그러나
클릭 경로가 제출 경로의 전부가 아니다. 텍스트 입력란에서 Enter 를 누르면 브라우저가
**암묵적 제출**을 수행하는데, 이때 폼에 `type="submit"` 버튼이 없으면 버튼을 거치지 않고
`submit` 이벤트가 바로 발생한다. 액션 버튼이 모달 푸터에 있거나 `type="button"` + `onClick`
으로 쓰인 폼 — 콘솔 화면에서 흔한 모양 — 이 정확히 그 경우다.

측정한 결과(`form.spec.tsx` 의 "the implicit submission bypass"):

| 폼 구성 | 클릭 3회 | 이어서 Enter 3회 |
| --- | --- | --- |
| 액션이 `type="button"`, `Button.loading` 만 | 1회 제출 (막힘) | **4회 제출 (뚫림)** |
| 같은 폼을 `<Form>` 으로 감쌈 | 1회 | **1회** |

그래서 가드는 **`<form onSubmit>` 에 둔다.** `useForm` 은 `useRef` 로 진행 중 여부를 들고
있다가(상태가 아니라 ref 인 이유: `setState` 는 다음 렌더까지 반영되지 않아 같은 틱의 두 번째
이벤트를 막지 못한다) 이미 진행 중이면 이벤트를 그대로 버린다. `Button.loading` 은 그대로 두어
**시각·보조기술 표현**과 클릭 경로를 담당한다 — 두 겹이다.

### 4.3 오류 표시 규약

| 항목 | 규약 |
| --- | --- |
| 위치 | 컨트롤 **바로 아래**. 힌트가 있으면 힌트 다음 |
| 색 | `text-danger` + 컨트롤 테두리 `border-danger`(`Input.invalid`). **색만으로 전달하지 않는다** — 문구가 본문이다 (WCAG 1.4.1) |
| 연결 | `aria-describedby="<id>-hint <id>-error"` — **존재하는 요소만** 참조한다. 없는 id 를 가리키면 axe `aria-valid-attr-value` 위반 |
| 무효 표시 | 컨트롤에 `aria-invalid="true"` |
| 낭독 | 제출 실패 시 **첫 무효 컨트롤로 포커스를 옮긴다.** 필드 오류마다 `role="alert"` 를 붙이면 열 개가 동시에 읽힌다 |
| 폼 단위 오류 | `FormError` 가 폼 맨 위에 `role="alert"` 로 렌더 (필드에 매핑되지 않은 서버 오류·네트워크 오류) |
| 문구 | 컴포넌트에 한국어를 쓰지 않는다. 메시지는 zod 스키마와 props 가 가져온다 |

### 4.4 서버 오류 → 필드 매핑

계약은 `packages/shared/src/api-error.ts` 의 `{ error: { code, message, details } }` 이고
`details` 는 `z.array(z.unknown())` 이다. `apps/api` 는 `parse-input.ts` 에서 zod 이슈를
`"<경로> 값이 올바르지 않습니다."` 문자열로 만들고, `all-exceptions.filter.ts` 의 `detailsOf` 가
**문자열만** 통과시킨다(객체는 버려진다).

그래서 `serverFieldErrors(details, options)` 는 **세 형태를 모두 받는다.**

1. `{ field | path, message }` 객체 — 구조화된 형태. **오늘 백엔드는 보내지 않는다**(4.5)
2. 문자열 — 선두 토큰이 알려진 필드 경로와 일치하면 그 필드로, 아니면 폼 단위로
3. `code` — `codeFields` 로 코드→필드를 지정 (`SLUG_TAKEN` → `slug` 처럼 **서버만 아는 오류**)

`packages/ui` 는 `@shopping/shared` 를 의존하지 않는다. 봉투 타입을 UI 패키지가 다시 정의하면
계약 게이트 C1 이 말하는 이중 정의가 되므로, **호출하는 앱이 `ApiClientError` 에서 꺼낸
`details` 배열과 `code` 를 넘긴다.** UI 는 "그 배열을 어떻게 필드에 붙이는가"라는 규약만 가진다.

### 4.5 열린 항목 — `details` 가 구조화되어 있지 않다

문자열 매칭은 **필드 경로가 메시지 맨 앞에 오는 한** 동작하지만, 문구가 바뀌면 조용히 깨진다.
필요한 것은 `packages/shared` 에 필드 오류 항목 스키마를 두고 `parse-input.ts` 가 그것을
보내는 것이다.

```ts
// packages/shared — 이번 TASK 범위 밖 (TASK-0030 소유)
export const apiFieldErrorSchema = z.object({
  field: z.string().min(1),   // 'name' · 'attributes.material'
  message: z.string().min(1),
  code: z.string().optional(),
})
```

그러면 `detailsOf` 도 문자열만이 아니라 **이 스키마를 통과하는 객체**를 함께 통과시켜야 한다.
`serverFieldErrors` 는 이미 그 형태를 우선 처리하므로 백엔드가 보내기 시작하면 UI 변경 없이 붙는다.

### 4.6 동적 폼 생성기

`FieldDef` 는 TASK-0030 의 `AttributeDefinition` 타입 목록과 **1:1** 이다 (R1).

```ts
type FieldType = 'text' | 'number' | 'select' | 'multiselect' | 'boolean'
type FieldDef = {
  key: string; label: string; type: FieldType
  options?: readonly FieldOption[]; required?: boolean
  order?: number; hint?: string; placeholder?: string
}
```

| `AttributeDefinition.type` | `FieldDef.type` | 렌더 | 생성 스키마(필수) | 생성 스키마(선택) |
| --- | --- | --- | --- | --- |
| `TEXT` | `text` | `Input` | `z.string().trim().min(1)` | `z.string().trim()` |
| `NUMBER` | `number` | `Input type=number` | `z.number()` (빈 값 거부) | `z.number().optional()` |
| `SELECT` | `select` | `Select` | `z.enum(선택지)` | `z.enum(선택지).optional()` |
| `MULTI_SELECT` | `multiselect` | `Checkbox` 묶음(`fieldset`+`legend`) | `z.array(z.enum(...)).min(1)` | `z.array(z.enum(...))` |
| `BOOLEAN` | `boolean` | `Checkbox` | `z.boolean()` | `z.boolean()` |

순수 함수 3개가 생성기의 전부이며 **분기 커버리지 100%** 대상이다.

- `resolveFields(defs)` — `order` → `key` 로 정렬하고 타입별 컨트롤을 정한다
- `initialValuesForFields(defs)` — 타입별 초기값 (`''` / `''` / `''` / `[]` / `false`)
- `schemaForFields(defs, messages)` — 위 표의 zod 스키마. 문구는 `messages` 로 받는다

### 4.7 확인 다이얼로그 규약

| 항목 | 규약 |
| --- | --- |
| 대상 | 되돌릴 수 없는 작업 — 삭제·취소·환불·발행 취소 |
| 기반 | `Modal` (Radix Dialog) — 포커스 트랩·Escape·`aria-labelledby` 를 그대로 씀 |
| 기본 포커스 | 확인 버튼이 아니다. Radix 가 닫기(×) 버튼에 포커스를 두므로 **Enter 연타로 파괴되지 않는다** |
| Escape | 취소로 동작 (`dismissible`). 끄지 않는다 — Escape 를 무시하는 다이얼로그는 키보드 트랩이다 |
| 확인 버튼 | `destructive` 면 `variant="danger"`. 진행 중에는 `loading` 으로 중복 확인 차단 |
| 문구 | `title`·`description`·`confirmLabel`·`cancelLabel`·`closeLabel` 전부 props |
| 약속 | `useConfirm()` 이 `Promise<boolean>` 을 준다. **확인 전에는 작업 함수가 호출되지 않는다** |

## 5. 구현 계획

1. zod ↔ 폼 어댑터 (`validateWithSchema`, 이슈 → 필드 오류)
2. 에러 표시 규약 컴포넌트 (`FormField`, `FieldError`, `FormError`)
3. 서버 에러 매핑 (`serverFieldErrors`)
4. 제출 상태 관리 (`useForm` + `<Form>` 의 암묵적 제출 가드)
5. FieldDef 기반 동적 폼 생성기
6. 확인 다이얼로그 (`ConfirmDialog`, `useConfirm`)
7. 스토리 3편 + 스토리 커버리지 게이트를 `src/form` 까지 확장

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 스키마 공유 | 잘못된 값 제출 | 클라이언트가 먼저 차단, 우회 시 서버가 400 | [ ] |
| F2 | 서버 에러 매핑 | 서버만 아는 오류(중복 등) 유발 | 해당 필드에 메시지 표시 | [ ] |
| F3 | 중복 제출 | 제출 버튼 빠르게 3회 클릭 | 요청 1건만 발생 | [ ] |
| F4 | 접근성 | 스크린리더로 에러 확인 | 에러가 읽힘, `aria-invalid` 설정 | [ ] |
| F5 | 동적 폼 | FieldDef 5종 배열 전달 | 타입별 입력 요소 자동 생성 | [ ] |
| F6 | 확인 다이얼로그 | 파괴적 작업 트리거 | 확인 없이는 실행되지 않음 | [ ] |
| F7 | 암묵적 제출 | 입력란에서 Enter 연타 | 제출 1건만 발생 (4.2) | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — M05 부터 적용. 단 **동적 폼 생성기·오류 매핑은 분기 커버리지 100%**
  (`packages/ui/vitest.config.mjs` 의 per-file threshold 로 강제)
- **2장 화면 게이트**: P2·P3·P4·P5 적용
- **3~5장 해당 없음** — 엔드포인트·스키마 변경 없음. API 를 부르지 않으므로 계약 게이트 대상도 아니다

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |
| D5 | 도입 라이브러리 버전 기록 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 동적 폼이 M05 요구를 못 맞춤 | FieldDef 를 `AttributeDefinition` 의 타입 목록과 1:1 로 맞춰 설계 (4.6) |
| R2 | `details` 가 구조화되어 있지 않아 문자열 매칭에 의존 | 4.5 — `packages/shared` 에 `apiFieldErrorSchema` 필요. **TASK-0030 소유이므로 이번에 바꾸지 않는다** |
| R3 | 라이브러리 없이 간 결정이 M05 Variant 표에서 뒤집힐 수 있음 | 4.1 재검토 조건. 어댑터가 `useForm` 뒤에 있으므로 교체 지점이 한 곳이다 |

## 8. 확정된 버전

| 패키지 | 버전 | 비고 |
| --- | --- | --- |
| 폼 라이브러리 | **없음** | 4.1 — 직접 구현 |
| zod | 4.5.4 | `packages/ui` 에 추가. 동적 스키마 생성에 필요 |
| @vitest/coverage-v8 | 4.1.11 | 생성기 분기 커버리지 게이트 |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | 4.1 폼 라이브러리 선정(도입하지 않음) · 4.2 암묵적 제출 가드 · 4.4~4.5 서버 오류 매핑 규약 · 4.6 생성기 매핑표 · 4.7 확인 다이얼로그 규약 추가. F7 · R2 · R3 추가 |
