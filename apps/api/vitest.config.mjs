import { defineConfig } from 'vitest/config'

/**
 * Number of worker processes, and therefore of test databases.
 *
 * Fixed rather than derived from the core count so that the set of databases
 * `test/setup/global-setup.ts` creates is the same on every machine and in CI:
 * a run that sizes itself to the runner would leave a different number of
 * `shopping_test_w<n>` databases behind each time, and `VITEST_POOL_ID` — which
 * is what picks a worker's database — is only ever `1..maxWorkers`.
 *
 * Published on the environment because the global setup runs in this same
 * process and must agree with this number exactly; reading it back from here is
 * what keeps the two from drifting.
 */
const maxWorkers = Number(process.env.VITEST_MAX_WORKERS ?? '') || 4

process.env.VITEST_MAX_WORKERS = String(maxWorkers)

export default defineConfig({
  test: {
    // `dist` holds a compiled copy of every spec-free source file; restricting
    // the glob to `src` and `test` keeps the suite from ever running build output.
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // The global setup builds the template database and clones it once per
    // worker; the setup file points each worker at its own clone.
    globalSetup: ['./test/setup/global-setup.ts'],
    setupFiles: ['./vitest.setup.mjs', './test/setup/worker-database.mts'],
    environment: 'node',
    maxWorkers,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts'],
      /**
       * The coverage gate, switched on by the first M05 task (TASK-0028).
       *
       * QUALITY-GATES Q5 asks for two different numbers, so there are two kinds
       * of entry here.
       *
       * - **Backend services and API — line coverage 80%.** A global floor, not
       *   a per-file one: a small module that is exercised entirely through the
       *   endpoint above it would otherwise have to grow tests of its own that
       *   assert nothing new.
       * - **Pure logic — branch coverage 100%.** Named file by file, because
       *   "is this pure logic?" is a judgement and a glob would quietly answer
       *   it for code nobody looked at. Every path decision and every move
       *   refusal is decided in these two modules, and a branch nothing reaches
       *   is a rule nothing checks.
       *
       * Statements and branches are deliberately left without a global floor:
       * Q5 states line coverage for this layer, and adding numbers the gate
       * does not ask for is how a suite starts collecting tests that exist to
       * move a percentage.
       */
      thresholds: {
        lines: 80,
        'src/catalog/category-path.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/catalog/category-tree.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0030. The generator is the only thing standing between a typo
        // and a `Product.attributes` object nothing can read: values live in
        // JSONB, so the database accepts `{"weight": "무거움"}` as readily as
        // `{"weight": 1200}`. A branch nothing reaches here is a value nothing
        // refuses, and the symptom is not a red test — it is a product row that
        // no screen renders and no facet counts.
        'src/catalog/attribute-schema.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // The resolver decides which definitions reach a category and which of
        // two definitions of one key wins. The second half has to be a function
        // of the rows rather than of the order they arrived in, which is only
        // checkable by reaching every comparison.
        'src/catalog/attribute-inheritance.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0032. Two questions with no I/O and no second opinion: which
        // variants a product has, and how many of one an order may contain.
        // Both fail silently when they are wrong — a duplicated combination is
        // two rows answering one buyer selection, so the price shown depends on
        // which the planner returned first, and a cap resolved with the
        // precedence backwards is enforced by nobody while every screen still
        // displays it. Four other tasks will call `resolvePurchaseLimit`
        // (TASK-0045 · 0048 · 0049 · 0050), which is the reason it is a function
        // here rather than an expression in each of them.
        'src/catalog/variant-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0113. How a generated SKU is named when the seller names none.
        // The rule it replaces was wrong for a whole minute at a time — eight
        // hex characters of a UUIDv7 are the top 32 bits of a millisecond, so
        // every product one seller created inside 65 seconds got the same
        // prefix and the second one was refused by the SKU index. Nothing about
        // that failure was visible in a unit test, because the derivation had
        // no test: it was an expression inside the service. It has one now, and
        // the properties it has to keep — reproducible from the row, ordered by
        // creation, legal under the format check — are all properties of a
        // string function.
        'src/catalog/product-sku.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0113. Whether an image URL is one of our storage keys and, if it
        // is, whose. The orphan sweep that TASK-0033 F6 handed over enumerates
        // by `products/{sellerId}/` prefix, so a false "not ours" here is a
        // cross-store reference the save lets through — and the damage lands
        // later, somewhere else, as the *other* store's sweep deleting an object
        // this product displays. A false match is the mirror mistake: a seller
        // who cannot save a stock photograph. Neither shows up as a failing
        // test unless every branch is reached.
        'src/catalog/product-image-keys.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0115. Three decisions the seller console makes with no
        // database in front of them.
        //
        // The **stock band** is the one that matters most, because the boundary
        // it draws exists twice by necessity: the badge is decided in
        // TypeScript from a row, the filter by a comparison PostgreSQL makes
        // over a page. Nothing forces the two to agree, and when they disagree
        // the symptom is a seller filtering for 품절 임박 and getting rows with
        // no badge — a bug nobody reports because it looks like a display
        // preference. The spec holds the two against each other across the
        // whole range, which only means something if every branch is reached.
        // The name-search pattern is beside it for the same reason: an
        // unescaped `%` turns a filter into no filter at all, silently.
        'src/catalog/seller-product-filters.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // What a copy of a listing *is* — which fields carry over, which are
        // deliberately dropped, how a combination is named when its ids are
        // about to change. Every one of them fails quietly: a copied SKU makes
        // duplication always answer 409, a copied stock level is stock the
        // ledger cannot explain, and a combination assembled in join order
        // rather than axis order names the wrong variant while the request
        // still validates. Producing a request rather than writing rows is what
        // makes all of that reachable from a unit test.
        'src/catalog/product-duplicate.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // The store's own state gate, now in front of four endpoints. Listed
        // for the reason `src/sellers/seller-access.ts` is: its branches *are*
        // the cells of TASK-0108's capability table, and a branch nothing
        // reaches is a refusal nobody worded — or, worse, a suspended store
        // that can still change its catalogue.
        'src/catalog/store-write-gate.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0036. The ledger's rules: which signs a movement type admits,
        // what the stock is after one, and which of the four statements a
        // variant's history breaks. All of them fail silently when they are
        // wrong — a movement recorded with the wrong sign is a well formed row
        // that makes every reader of the ledger wrong, and a reconciliation
        // that never reports a fault looks exactly like a healthy system. A
        // branch nothing reaches here is a rule nothing checks, and the ledger
        // is the only thing that can ever answer "재고가 왜 줄었나".
        'src/stock/stock-ledger.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0048 (6.2, Q5 강화). 예약의 순수 판단: 가용재고가 얼마인지,
        // 만료가 언제인지, 그리고 확정·해제 요청 하나가 이 상태의 예약에 무엇을
        // 해야 하는지. 셋 다 틀려도 빨간 테스트로 나타나지 않는다 — 오버셀은
        // 팔린 뒤에 알고, 잠긴 재고는 아무도 신고하지 않으며, 멱등이 아닌 확정은
        // 결제 승인 웹훅이 두 번 오는 날에만 드러난다.
        'src/reservation/reservation-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0051 (6.2, Q5 강화). 만료 청소의 순수 판단: 멈췄는가, 그리고 두
        // 인스턴스가 같은 열쇠에 동의하는가.
        //
        // 앞의 것이 틀리면 **헬스체크가 멈춘 스케줄러를 건강하다고 말한다** — 그
        // 순간 재고는 잠긴 채로 아무 신호도 내지 않는다. 뒤의 것이 틀리면 두 잡이
        // 같은 수를 골라 하나가 영문 모른 채 건너뛴다.
        'src/reservation/reservation-sweeper.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0052 (6.2, Q5 강화). 결제의 상태 머신과 금액 검증.
        //
        // 여기가 틀리면 **돈이 잘못 나간다.** 정의 밖 전이를 통과시키면 승인 전
        // 결제가 매입되고, 상한 판단이 한 칸 어긋나면 받은 것보다 많이 환불된다.
        // 둘 다 실패로 나타나지 않고 장부에서만 보인다.
        'src/payment/payment-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0053 (6.2, Q5 강화). 카드번호·사용 가능액·한도 검증.
        //
        // 「원장 합계와 사용액이 일치한다」가 이 카드의 존재 이유다 — 환불이
        // 제대로 됐는지를 잔액으로 눈으로 확인하는 장치이기 때문이다. 여기가 한 칸
        // 어긋나면 그 확인이 거짓말이 되고, 어긋난 것은 대사할 때가 되어서야 보인다.
        'src/payment/virtual-card-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0055 (6.2, Q5 강화). 토스 연동의 순수 판단 — 금액 대조와 승인 경로.
        //
        // 재는 것은 「토스가 잘 도는가」가 아니라 **「우리가 토스를 잘못 믿지
        // 않는가」**다 (4.2). 금액 대조의 갈래가 하나라도 비면 결제창 리다이렉트의
        // 쿼리스트링을 그대로 믿는 셈이고, 그 값은 사용자가 고칠 수 있다. 거절
        // 이유의 **순서**도 여기 걸린다 — 프로바이더보다 금액을 먼저 보면 「금액이
        // 틀렸다」를 남의 결제에 대해 돌려주게 된다. 상태 매핑은 빠진 칸이 곧
        // 대사가 읽지 못하는 상태이고, 그것은 빨간 테스트가 아니라 장부의 구멍이다.
        //
        // `toss.client.ts` 는 일부러 빼 둔다. 입출력이 섞인 파일에 100%를 걸면 닿을
        // 수 없는 방어 갈래를 지우게 되고(`order-plan.ts` 옆 주석과 같은 이유), 그
        // 파일이 재야 할 것 — 나간 요청과 오류 해석 — 은 수치가 아니라
        // `toss.client.spec.ts` 의 단언이 맡는다.
        'src/payment/toss-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0056 (6.2, Q5 강화). 대사 배치의 순수 판단 — 언제 물어보고, 무엇을
        // 세고, 무엇을 남기는가.
        //
        // 세 갈래가 전부 조용히 틀린다. **유예**가 어긋나면 배치는 매 주기
        // `pending` 만 받아 오고, 그것은 「도는데 아무것도 안 풀리는」 모양이라
        // 로그에도 헬스체크에도 정상으로 보인다. **세는 자리**가 어긋나면
        // `AppMeta` 에 적히는 건수가 틀리고, 그 숫자는 「대사가 일하고 있는가」를
        // 묻는 유일한 자리다. **로그 판단**이 어긋나면 1분마다 「0건」이 쌓여
        // 정작 읽어야 할 한 줄이 그 사이에 묻힌다.
        'src/payment/payment-reconcile.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0056 (6.2, Q5 강화). 웹훅 수신의 순수 판단 — 서명이 맞는가, 본문이
        // 어느 결제를 가리키는가.
        //
        // **거절하는 갈래가 본업인 모듈이라 100% 가 아니면 뜻이 없다.** 통과만
        // 재는 스펙은 「언제나 참을 돌려주는 서명 검증」도 통과시키고, 그 구현은
        // 인증 가드 밖의 라우트를 아무에게나 여는 것이다. 시크릿이 없을 때·길이가
        // 다를 때·다른 시크릿으로 서명됐을 때가 각각 다른 분기이고, 그중 하나만
        // 빠져도 결제 상태를 남이 흔들 수 있게 된다.
        //
        // 열쇠를 읽는 쪽도 같다. uuid 검사를 지나치는 갈래가 하나 열리면 남의
        // 웹훅 하나가 500 을 만들고, PG 는 그것을 영원히 재전송한다.
        'src/payment/payment-webhook.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0057 (6.2, Q5 강화). 낙오 배치의 순수 판단 — 두 방향이 각각
        // **언제** 손대도 되는가, 그리고 무엇을 세고 무엇을 남기는가.
        //
        // 여기가 틀리는 방식이 둘이고 **둘 다 조용하다.** 앞쪽 유예가 짧으면
        // 배치가 방금 매입한 결제의 `markPaid` 와 겹쳐 같은 예약을 두 곳에서
        // 확정하려 든다 — 증상은 「가끔 결제가 실패한다」다. 뒤쪽 임계치가
        // 짧으면 **아직 살아 있는 승인을 우리가 취소한다**(R1). 그것은 빨간
        // 테스트가 아니라 산 사람의 결제가 사라지는 일이고, 그래서 상한과
        // 임계치의 부등식까지 이 파일의 스펙이 단언한다.
        'src/payment/payment-straggler.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        /**
         * TASK-0049 (6.2). 「주문 생성 트랜잭션은 분기 커버리지 100%」를 두 순수
         * 모듈로 받는다 (4.7).
         *
         * `await` 가 섞인 파일에 100% 를 걸면 닿을 수 없는 방어 분기가 생기고,
         * 그것은 게이트를 만족시키려고 코드를 나쁘게 만드는 일이다 — `hangul.ts` 와
         * `pricing/allocate.ts` 에서 이미 겪었다. 그래서 **판단만** 이 두 파일에
         * 있고 트랜잭션에는 쓰기만 남는다.
         *
         * 여기가 틀리면 조용하다. 계산 결과와 줄이 어긋난 채 저장되면 주문 금액이
         * 항목 합보다 적어지고 그 차액은 아무 데도 기록되지 않으며, 주문번호의
         * 형식이 갈라지면 「전화로 불러 줄 수 있는 번호」라는 성질만 사라진다.
         */
        'src/orders/order-plan.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/orders/order-number.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        /**
         * TASK-0059 (6.2, Q5 강화). 판매자 몫 주문의 전이 표 — 어느 상태에서
         * 어디로, 누가, 무엇을 갖추고.
         *
         * 여기가 틀리는 방식이 전부 조용하다. 표에 없는 칸이 하나 열리면 발송된
         * 적 없는 주문이 배송완료로 앉고 D+7 자동 확정이 그것을 정산까지 밀어
         * 준다. 주체가 한 칸 넓으면 구매자가 남의 물건을 발송 처리하고, 거절
         * 이유의 순서가 뒤집히면 「권한이 없다」가 애초에 불가능한 요청에 대해
         * 나가 사용자가 권한을 구하러 간다. 셋 다 빨간 테스트가 아니라 나중에
         * 주문 하나로 나타난다.
         *
         * 닿지 않는 분기는 아무도 거절하지 않는 조합이라는 뜻이고, 그래서
         * `payment-rules.ts` 와 같은 줄에 선다.
         */
        'src/orders/seller-order-transitions.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        /**
         * TASK-0060 (6.2, Q5 강화). 판매자 콘솔이 목록과 뱃지를 그리기 전에 서버가
         * 내리는 판단 — 이름을 어떻게 가리고, 무엇을 「처리 대기」로 세는가.
         *
         * 셋 다 틀려도 빨간 검사가 되지 않는다. **마스킹**이 한 칸 어긋나면 수령인
         * 이름이 목록 응답에 그대로 실려 나가는데 화면은 정상으로 보이고, 알아차리는
         * 사람은 응답 본문을 열어 본 사람뿐이다. **뱃지의 상태 집합**이 한 칸 넓으면
         * 판매자가 할 일이 없는데 「3건 대기」가 떠 있고 그 숫자는 영영 줄지 않는다 —
         * 줄지 않는 뱃지는 곧 아무도 안 보는 뱃지다. **0건 채우기**가 빠지면 탭이
         * 숫자를 잃고, 화면은 「0건」과 「아직 못 읽었다」를 구분하지 못한다.
         */
        'src/orders/seller-order-console.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        /**
         * TASK-0061 (6.2, Q5 강화). 가상 운송장의 순수 판단 — 번호를 어떻게 만들고,
         * 그것이 우리가 만든 모양인지, 어느 운송사인지, 사건 하나가 배송을 어느
         * 상태로 옮기는지.
         *
         * **이 파일이 지키는 성질은 하나이고, 무너져도 아무 검사가 빨개지지 않는다:
         * 발급한 번호가 진짜 운송장과 구분된다** (F2 · R1). 접두어가 빠진 번호는 잘
         * 생긴 문자열이라 스키마도 화면도 반기고, 알아차리는 사람은 그것을 실제
         * 택배사 조회창에 넣어 본 사람뿐이다. 사건 → 상태 매핑도 같은 종류다 —
         * 빠진 칸은 「도착했는데 이동 중이라고 적힌 배송」이고, 그것은 오류가 아니라
         * 이상한 화면으로 나타난다.
         */
        'src/shipping/shipment-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        /**
         * TASK-0117. The error contract's decision-making, all of it pure:
         * which code and sentence a status maps to, what a domain failure's
         * payload looks like, which `details` shape one zod issue becomes, and
         * what goes into the envelope.
         *
         * A branch nothing reaches here is a failure nobody can read — and the
         * symptom is not a red test. It is an error that renders in the wrong
         * place, or with no sentence at all, while every check stays green.
         * That is the exact failure this task exists to remove, so the modules
         * that decide it are held to the 순수 로직 row of Q5.
         */
        'src/common/domain-failure.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/common/error-response.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/common/http-error-code.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/common/parse-input.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0011. The signature is the reason this floor is here: a branch
        // nothing reaches is a canonicalisation rule nothing checks, and the
        // symptom of getting one wrong is a 403 from the storage on some
        // subset of filenames rather than a failing test. The upload rules and
        // the environment reader are the other two pieces that decide something
        // without asking anybody — QUALITY-GATES Q5's 순수 로직 row.
        'src/storage/sigv4.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/storage/upload-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/config/storage-config.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Same reasoning as `storage-config.ts`: the interesting cases are the
        // ones nothing else exercises. "Neither variable set" is the state CI
        // runs in, and "one of them set" is a boot refusal no endpoint can
        // reach — both only ever run here (TASK-0021 4장).
        'src/config/google-config.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0108. Two tables and nothing else: which move is legal from
        // which state, and what a store in a given state may do. Both fail
        // silently when they are wrong — a missing transition makes the first
        // rejection permanent and no test goes red, and a capability cell
        // written the wrong way round either lets a suspended store keep
        // listing products or stops a suspended store shipping goods somebody
        // already paid for. Neither symptom is a failing check; both are a
        // person finding out later.
        //
        // `seller-access.ts` is listed beside it because it is the same
        // decision with a throw on the end, and its branches *are* the cells of
        // the table — a branch nothing reaches is a refusal nobody worded.
        'src/sellers/seller-status.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/sellers/seller-access.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0024. Three decisions with no I/O, and all three fail quietly.
        //
        // `demo-persona.ts` pairs an app with the persona it may issue: get a
        // cell wrong and a visitor is signed into a cookie their console never
        // reads — no error, no log line, a demo that simply goes nowhere.
        //
        // `demo-identity.ts` names the account and its store. Every value has an
        // index or a schema behind it (`Seller_brandName_key`,
        // `ProductVariant_seller_sku_key`, `sellerSlugSchema`), so a branch
        // nothing reaches is a name nothing refuses — and the refusal lands on
        // the visitor mid-issue rather than on a test.
        //
        // `demo-rate-limit.ts` decides the bucket, the window and the
        // comparison. Off by one in either direction is invisible: too tight
        // blocks the three-tab visitor F7 promises, too loose lets ten through
        // where F6 expects five.
        'src/demo/demo-persona.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/demo/demo-identity.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/demo/demo-rate-limit.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // The function that makes an open redirect unrepresentable. A branch
        // nothing reaches here is an app that could be sent somewhere nobody
        // vetted (TASK-0021 F10).
        'src/config/app-origins.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Signing and verification. A branch nothing reaches here is a token
        // shape nobody decided about — and the reason this module can be
        // hand-written at all is that every one of them is named by a test
        // (TASK-0022 4장).
        'src/auth/jwt.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Where the cookie attributes are actually decided. `session-cookie.ts`
        // is deliberately **not** listed: it has no conditional of its own — its
        // only one (`secure` → `Secure`) lives here — so a threshold there would
        // read as a guarantee while enforcing nothing.
        'src/auth/cookies.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Cookie attributes and the one-time comparison. `SameSite=Lax` and the
        // length guard in `statesMatch` are both cases a real browser or a
        // hostile caller reaches and an endpoint spec does not.
        'src/auth/oauth-state.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0111. Which address is the default, with no I/O. The partial
        // unique index says "never two"; it cannot say "while there are
        // addresses, one of them". That half is decided here, and it fails
        // silently — an account whose default was deleted and never replaced
        // has an address book that looks entirely normal, and what breaks is
        // checkout (M07), later, on the one account it happened to. A branch
        // nothing reaches is a moment nobody decided about.
        'src/profile/default-address.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
})
