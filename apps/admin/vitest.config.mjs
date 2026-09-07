import { nextAppVitestConfig } from '@shopping/config/vitest/next-app'

/** Everything a `100` in `thresholds` means. */
const complete = { branches: 100, functions: 100, lines: 100, statements: 100 }

const base = nextAppVitestConfig(import.meta.dirname)

/**
 * The shared preset, plus this app's coverage gate.
 *
 * **No global floor.** QUALITY-GATES Q5 gives the front-end layer an interaction
 * list rather than a number, on the grounds that a coverage target on UI code
 * buys tests that render and assert nothing.
 *
 * **The modules below are the 순수 로직 row of that same table.** A branch
 * nothing reaches in them renders the wrong thing rather than failing a test.
 *
 * `src/lib/errors.ts` and `src/lib/api-failure.ts` used to be on this list and
 * are no longer here: they moved to `packages/shared/src/api/` (D-219) and the
 * threshold went with them — `packages/shared/vitest.config.mjs` holds both to
 * the same 100%. `test/errors.spec.ts` stays, because what it checks now is this
 * console's own catalog against those functions, and it is the only catalog with
 * a placeholder to interpolate.
 */
export default {
  ...base,
  test: {
    ...base.test,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.{ts,tsx}'],
      thresholds: {
        // TASK-0031's decisions, taken before anything is drawn: which category
        // is offered, which order a generated form asks in, whether a choice
        // list is acceptable, what a move exchanges. A missed branch in any of
        // them renders a wrong form rather than failing a test.
        'src/lib/attributes/categories.ts': complete,
        'src/lib/attributes/options.ts': complete,
        'src/lib/attributes/order.ts': complete,
        'src/lib/attributes/preview.ts': complete,
        'src/lib/attributes/text.ts': complete,
        // TASK-0110's one decision taken before anything is drawn: which
        // actions a status offers, which permission each needs, whether a
        // reason is required. It is a **mirror** of the transition table in
        // `apps/api` (see the file), so a branch nothing reaches is a row of
        // the review queue offering the wrong buttons — and the symptom is
        // never a red test, because the buttons still render.
        'src/lib/sellers/decisions.ts': complete,
        // TASK-0071's decisions, taken before anything is drawn: which
        // rejections can be overturned, what a return reason records as fault,
        // what an intervention actually sends, and which instants a chosen day
        // covers. Two of those tables are **mirrors** of `apps/api` (see the
        // file), and a branch nothing reaches is a screen offering the wrong
        // button or a request built against the wrong order — neither of which
        // fails a test, because the screen still renders.
        'src/lib/claims/claim-console.ts': complete,
        // TASK-0071 F4's decisions, taken before anything is drawn: what may be
        // typed into the lookup (and which of those the repository has no route
        // for), which order states this intervention can begin from, which
        // reasons a confirmed order may be reversed for, and what the request
        // that reverses it carries. A missed branch offers a return form on an
        // order the server will refuse, or hides one it would accept — and the
        // screen renders either way.
        'src/lib/claims/defect-return.ts': complete,
        // TASK-0073 의 판단들. 「발급 수량 × 최대 할인액」은 **틀려도 조용하다** —
        // 화면은 그럴듯한 숫자를 하나 그리고, 발행자는 그것을 보고 버튼을 누른다.
        // 특히 상한 없는 정률 쿠폰의 최대 비용은 무한대이므로, 닿지 않은 분기 하나가
        // 「퍼센트 × 장수」라는 뜻 없는 곱셈을 화면에 남긴다. 사용률의 0 나눗셈과
        // 사람이 친 숫자의 파싱도 같은 성질이다.
        'src/lib/coupons/platform-coupons.ts': complete,
        // TASK-0079 의 판단들, 화면이 그려지기 전에 내려진 것. **사람이 친 퍼센트를
        // 계약의 정수로 옮기는 일**이 여기 있고, 그것이 틀리면 조용하다 — 화면은
        // 멀쩡히 그려지고 검사는 초록이며, 달라지는 것은 모든 판매자의 다음 정산
        // 금액뿐이다. `scopes.ts` 도 같은 성질이다: 「아직 고르지 않았다」를 전역으로
        // 접는 분기 하나가 아무도 그러려던 적 없는 전역 요율을 바꾼다.
        'src/lib/commissions/rate-bp.ts': complete,
        'src/lib/commissions/scopes.ts': complete,
        // TASK-0081 의 판단들, 화면이 그려지기 전에 내려진 것. 넷 다 **틀려도
        // 조용하다**: `transitions.ts` 는 `apps/api` 의 전이표를 비추는 거울이라
        // 닿지 않은 분기 하나가 정산서에 없는 버튼을 내거나 있어야 할 버튼을
        // 감추고, `settlement-console.ts` 의 회차 계산이 한 주 어긋나면 화면은
        // 「이 조건에 정산서가 없습니다」를 멀쩡히 그린다. `csv.ts` 는 더하다 —
        // 따옴표 하나를 놓치면 열이 밀린 파일이 **열리고, 읽히고, 틀린다.**
        // `format.ts` 는 금액과 회차의 경계를 그리는 마지막 자리다.
        'src/lib/settlements/transitions.ts': complete,
        'src/lib/settlements/settlement-console.ts': complete,
        'src/lib/settlements/csv.ts': complete,
        'src/lib/settlements/format.ts': complete,
        // The photo gate in front of `POST /uploads/presign`. A missed branch
        // spends a round trip on a file the API refuses, and answers with a 400
        // that cannot say which file was at fault.
        'src/lib/claims/return-photos.ts': complete,
        // TASK-0091 의 판단들, 화면이 그려지기 전에 내려진 것. `outcomes.ts` 는
        // `apps/api` 의 `report-rules.ts` 를 비추는 거울이라 닿지 않은 분기 하나가
        // 상품에 삭제 버튼을 내거나 리뷰에서 그것을 감춘다. 그보다 나쁜 것은
        // **반려의 효과**다 — 그것이 `reveal` 이 아니게 되는 날 화면은 「반려하면
        // 다시 보입니다」를 멀쩡히 그리면서 아무것도 복구하지 않는다.
        // `report-console.ts` 도 같은 성질이다: 상태 묶음이 어긋나면 「이 조건에
        // 신고가 없습니다」가, 거절 분류가 어긋나면 데모 관리자의 403 이 「일시적인
        // 문제가 생겼어요」가 되어 몇 번이고 다시 눌린다.
        'src/lib/reports/outcomes.ts': complete,
        'src/lib/reports/report-console.ts': complete,
        // TASK-0090 의 폴링 판단. **틀려도 조용하다** — 화면은 멀쩡히 그려지고
        // 달라지는 것은 배경 탭이 30초마다 서버를 두드리는 일뿐이며(R1), 배지
        // 문자열이 틀리면 「할 일 0개」가 그려진 채 알림이 쌓인다.
        'src/lib/notifications/notification-console.ts': complete,
        // TASK-0092 의 판단들, 화면이 그려지기 전에 내려진 것. 셋 다 **틀려도
        // 조용하다.** `dashboard-console.ts` 의 기간 산술이 하루 어긋나면 화면은
        // 멀쩡한 그래프를 그리고, 증감의 분모가 0인 자리를 놓치면 「+100% 늘었어요」가
        // 뜬다 — 그리고 운영자는 그 숫자를 보고 「이번 주는 괜찮다」고 판단한다.
        // 처리 대기의 링크가 틀리면 건수는 맞는데 눌러도 엉뚱한 화면이 열린다.
        // `schedulers.ts` 는 더하다: 이름을 못 붙인 배치를 **숨기는** 분기 하나가
        // 멈춘 배치를 화면에서 지우고, 그것이 정확히 이 화면이 막으려던 일이다.
        // `chart.ts` 의 좌표는 틀려도 선이 하나 그려진다 (`apps/seller` 의 같은
        // 파일이 같은 이유로 같은 자리에 있다).
        'src/lib/dashboard/dashboard-console.ts': complete,
        'src/lib/dashboard/schedulers.ts': complete,
        'src/lib/dashboard/chart.ts': complete,
      },
    },
  },
}
