import { isBlank, isSet } from './env-value.js'
import type { EnvIssue } from './env.schema.js'

/**
 * 토스페이먼츠 자격증명 (TASK-0055 4.1).
 *
 * `google-config.ts` 와 같은 모양이고 같은 이유다 — 규칙이 **변수마다**가 아니라
 * 「둘 다 또는 하나도」이기 때문에 `env.schema.ts` 의 필드 검증으로는 쓸 수 없다.
 *
 * 이 저장소가 이 모양을 세 번째로 쓰는 것이고(그전은 R2 와 Google), 세 번 다 같은
 * 것을 산다: **자격증명이 없으면 그 기능만 없고 나머지는 그대로 돈다.** CI 에 토스
 * 키를 넣지 않아도 모든 잡이 초록이고, 키를 발급받기 전에도 가상 카드로 전체 흐름이
 * 완결된다 (D-031).
 */
export interface TossConfig {
  /** 결제창을 여는 열쇠. **브라우저로 나간다** — 공개돼도 그 자체로는 결제가 안 된다. */
  readonly clientKey: string
  /** 승인·취소 API 의 열쇠. **서버에만 있다** (R1). */
  readonly secretKey: string
}

export interface TossResolution {
  /** 둘 다 없으면 `null` — 오류가 아니라 지원되는 상태다. */
  readonly config: TossConfig | null
  readonly issues: readonly EnvIssue[]
}

/**
 * 클라이언트 키에 `NEXT_PUBLIC_` 이 붙어 있는 것이 의도다.
 *
 * Next.js 는 그 접두어가 붙은 변수만 브라우저 번들에 넣는다. 결제창을 띄우는 것이
 * 브라우저라서 그 키는 거기 있어야 하고, **시크릿 키에는 그 접두어가 없어야 한다** —
 * 붙는 순간 승인·취소의 열쇠가 번들에 박힌다. 이름 자체가 스위치다.
 */
const VARIABLES = ['NEXT_PUBLIC_TOSS_CLIENT_KEY', 'TOSS_SECRET_KEY'] as const

type Source = Readonly<Record<string, string | undefined>>

/**
 * 토스 키를 읽거나, 왜 못 읽는지 말한다.
 *
 * | 환경 | 결과 |
 * | --- | --- |
 * | 둘 다 없음 | `config: null`. API 는 뜨고 토스만 결제수단에 없다 |
 * | 둘 다 있음 | 설정 |
 * | 하나만 있음 | issues — 부팅을 거부한다 |
 *
 * **세 번째 줄이 이 함수의 존재 이유다.** 반쪽짜리 설정으로 뜨면 결제창은 열리는데
 * 승인이 안 되고, 그 증상은 사용자에게 「결제 실패」로만 보인다 — 설정 실수를
 * 사용자가 대신 겪는 모양이다. 멈춘 프로세스가 잘못된 프로세스보다 싸다.
 */
export function resolveTossConfig(source: Source): TossResolution {
  if (VARIABLES.every((variable) => isBlank(source[variable]))) {
    return { config: null, issues: [] }
  }

  const issues: EnvIssue[] = []

  for (const variable of VARIABLES) {
    // 값을 절대 인용하지 않는다. 시크릿 쪽이 부팅 로그에 남는다.
    if (isBlank(source[variable])) issues.push({ variable, reason: '설정되지 않았습니다' })
  }

  const clientKey = source.NEXT_PUBLIC_TOSS_CLIENT_KEY
  const secretKey = source.TOSS_SECRET_KEY

  // `issues.length` 로 추론하지 않고 다시 본다 — 컴파일러가 그것을 따라가지 못하고,
  // `?? ''` 로 달래면 어떤 입력으로도 닿을 수 없는 갈래가 하나 생긴다.
  if (isSet(clientKey) && isSet(secretKey)) return { config: { clientKey, secretKey }, issues }

  return { config: null, issues }
}
