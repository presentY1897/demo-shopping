import { nestConfig } from '@shopping/config/eslint/nest'

/**
 * Time is injected, never read (QUALITY-GATES 6장, TASK-0106 4.7).
 *
 * Written as a lint rule and not only as a convention because a convention is
 * half-kept within a few months, and the symptom is invisible: a service that
 * calls `new Date()` still passes its tests, it just cannot be tested for
 * anything that depends on *when* — expiry sweeps, settlement cut-offs, token
 * lifetimes.
 *
 * Only the zero-argument form is forbidden. `new Date(iso)` and
 * `new Date(milliseconds)` construct a value from something the caller already
 * has and are exactly what a `Clock` implementation and a fixture use.
 *
 * `src/common/clock.ts` holds the single allowed reading of the process clock
 * and marks it with an inline disable, so the exemption is visible at the line
 * that uses it rather than in a list somewhere else.
 */
const injectedTimeRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
      message:
        '현재 시각은 Clock 포트로 주입받으세요 (src/common/clock.ts). new Date() 는 테스트에서 고정할 수 없습니다.',
    },
    {
      selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
      message:
        '현재 시각은 Clock 포트로 주입받으세요 (src/common/clock.ts). 경과 시간 측정은 performance.now() 를 쓰세요.',
    },
  ],
}

export default [
  ...nestConfig(import.meta.dirname),
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'test/**/*.mts', 'prisma/**/*.mts'],
    rules: injectedTimeRules,
  },
]
