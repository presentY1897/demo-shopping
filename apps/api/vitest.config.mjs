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
