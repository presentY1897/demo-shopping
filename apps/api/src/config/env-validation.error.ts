import type { EnvIssue } from './env.schema.js'

/**
 * Renders the operator facing report for a failed boot.
 *
 * It names the variables and the constraint they broke and nothing else: half
 * of them are credentials, so echoing the received value would put a secret in
 * the process output, the container log and whatever ships those logs onward.
 */
export function formatEnvIssues(issues: readonly EnvIssue[]): string {
  const lines = [
    '환경변수 검증에 실패했습니다. API 를 시작할 수 없습니다.',
    '',
    ...issues.map((issue) => `  - ${issue.variable}: ${issue.reason}`),
    '',
    '  .env.example 를 참고해 저장소 루트의 .env 를 채운 뒤 다시 실행하세요.',
    '  (보안을 위해 실제 값은 출력하지 않습니다.)',
  ]

  return lines.join('\n')
}

/** Thrown by the config loader; `main.ts` turns it into a non-zero exit. */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[]

  constructor(issues: readonly EnvIssue[]) {
    super(formatEnvIssues(issues))
    this.name = 'EnvValidationError'
    this.issues = issues
  }
}
