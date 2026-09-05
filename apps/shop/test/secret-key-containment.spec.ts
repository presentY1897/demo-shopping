/**
 * TASK-0055 6.2 의 「secretKey 가 클라이언트 번들에 포함되지 않는지 확인」을,
 * 확인이 아니라 **검사**로 둔 것이다 (4.4 · R1).
 *
 * 막는 사고는 구체적이다. 누군가 승인 키의 이름을
 * `NEXT_PUBLIC_` + `TOSS_…_KEY` 로 짓는 순간 Next.js 가 그 값을 **브라우저 번들에
 * 박아 넣는다**. 그러면 남이 우리 결제를 확정하거나 취소할 수 있다. 이 실수는
 * 타입 검사도 린트도 통과한다 — 변수 이름 하나가 서버 전용과 공개의 경계이기
 * 때문이고(`apps/api/src/config/toss-config.ts`: 「이름 자체가 스위치다」),
 * 이름은 어느 도구도 읽지 않는다. 그래서 이 파일이 읽는다.
 *
 * ## 무엇을 보는가
 *
 * | # | 규칙 | 보는 곳 |
 * | --- | --- | --- |
 * | 1 | 공개 접두어 뒤에 곧바로 붙은 시크릿 이름 (`NEXT_PUBLIC_…SECRET…`) | 아래 `ALL_SOURCE` 전부 |
 * | 2 | 토스 승인 키의 변수 이름 자체 | shop 앱의 소스와 `next.config.ts` |
 * | 3 | 토스 시크릿 키 모양의 문자열 리터럴 (`test_sk_`·`live_sk_` + 키 몸통) | `ALL_SOURCE` 전부 |
 *
 * 규칙 2 가 shop 만 보는 이유: **서버가 그 변수를 읽는 것은 정상이다.** 승인·취소는
 * `apps/api` 가 하고 그 이름은 거기 있어야 한다. 반대로 shop 은 그 값을 쓸 일이
 * 전혀 없으므로, 이름이 등장하는 것 자체가 이미 잘못이다 — 주석이라도 그렇다.
 * 규칙 1 과 3 은 어디서도 옳지 않아서 `apps/api/src` 까지 본다.
 *
 * `next.config.ts` 가 목록에 있는 것은 우연이 아니다. Next 의 `env` 블록은
 * `NEXT_PUBLIC_` 접두어 없이도 값을 번들에 인라인하므로, 소스 밖에 있는 두 번째
 * 누출 경로다.
 *
 * `*.spec.ts(x)` 는 제외한다. 스펙은 번들에 실리지 않으므로 「클라이언트가 닿는
 * 소스」가 아니고, 스펙의 가짜 키 픽스처까지 막으면 다음 사람이 고치는 것은
 * 픽스처가 아니라 이 검사다.
 *
 * ## 무엇을 보지 **않는가**
 *
 * - **빌드 산출물(`.next`)을 읽지 않는다.** 이 앱의 `test` 스크립트는 `vitest run`
 *   하나뿐이라 CI 는 빌드 없이 테스트를 돈다 — `.next` 가 있을 때만 도는 검사는
 *   정작 PR 에서 한 번도 돌지 않는 장식이 된다. 그래서 산출물 대신 **사람이 실수를
 *   저지르는 자리**, 즉 이름을 본다. 이 검사가 초록이라는 것은 「번들이 깨끗함이
 *   증명됐다」가 아니라 「번들에 그 값이 들어갈 이름을 아무도 쓰지 않았다」는 뜻이다.
 * - 의존성이나 생성 파일을 통해 들어오는 값은 범위 밖이다. 여기서 보는 것은 이
 *   저장소가 직접 쓴 소스뿐이다.
 * - **값을 모른다.** 진짜 키를 `const k = 'aGVsbG8…'` 처럼 토스 접두어 없이
 *   하드코딩하면 잡지 못한다. 그것은 비밀 스캐너의 몫이다.
 * - 런타임 유출 — 로그, 에러 응답, 서버가 클라이언트에 내려보내는 JSON — 도 범위
 *   밖이다. 그쪽은 `google-config.spec.ts` 처럼 값을 인용하지 않는지 재는 검사가
 *   따로 맡는다.
 *
 * ## 이 파일이 자기 검사에 걸리지 않는 방법
 *
 * 금지된 문자열을 통째로 적지 않는다. `assemble()` 로 조각을 붙여 만들고, 정규식도
 * 픽스처도 **같은 상수에서** 파생시킨다 — 그래서 매처와 픽스처가 따로 놀 수 없다.
 * 이 파일은 `test/` 에 있어 스캔 대상(`src`)에 들어가지도 않지만, 그 사실에 기대면
 * 스캔 범위가 넓어지는 날 이 파일이 첫 번째 오탐이 된다. 저장소 전체를 대상으로 한
 * `grep` 이 여기서 멈추지 않는 이점도 있다.
 *
 * 위 표에 접두어가 맨몸으로 적혀 있는 것은 예외가 아니다. 규칙 3 은 접두어 뒤에 키
 * 몸통이 있어야 걸리도록 일부러 그렇게 썼고, 그래서 「그 접두어로 시작한다」고
 * 설명하는 산문은 — `.env.example` 의 토스 절이 그렇듯 — 애초에 금지된 문자열이
 * 아니다.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(APP_ROOT, '..', '..')

/** 조각을 붙인다. 금지된 이름이 이 파일에 통째로 적히지 않게 하는 유일한 장치다. */
function assemble(...fragments: readonly string[]): string {
  return fragments.join('')
}

const PUBLIC_PREFIX = 'NEXT_PUBLIC_'
const SECRET = assemble('SEC', 'RET')
/** 승인·취소 API 의 열쇠를 담는 환경변수 이름 (`.env.example` 토스 절). */
const SECRET_VARIABLE = assemble('TOSS_', SECRET, '_KEY')
/** 토스 시크릿 키의 접두어. 테스트 키만 쓰지만(4.1) 운영 접두어도 같이 막는다. */
const KEY_PREFIXES = [assemble('test_', 'sk', '_'), assemble('live_', 'sk', '_')]

interface Rule {
  /** 실패 메시지에 그대로 실린다. */
  readonly name: string
  readonly pattern: RegExp
  readonly roots: readonly string[]
}

interface Finding {
  /** 저장소 기준 상대 경로. */
  readonly file: string
  readonly rule: string
}

/**
 * 규칙 1 의 문자 클래스가 식별자 문자뿐인 것이 핵심이다.
 *
 * `apps/api/src/config/toss-config.ts` 는 두 변수 이름을 **한 줄에 나란히** 적는다:
 * `['NEXT_PUBLIC_TOSS_CLIENT_KEY', '<시크릿 이름>']`. `.*` 로 썼다면 그 줄이 걸렸을
 * 것이고, 그 오탐을 없애려고 규칙을 무르게 고쳤을 것이다. 따옴표도 공백도 넘지 못하는
 * 클래스라서, 걸리는 것은 **하나의 이름 안에서** 공개 접두어와 시크릿이 만날 때뿐이다.
 */
function rulesOver(allSource: readonly string[], shopSource: readonly string[]): readonly Rule[] {
  return [
    {
      name: `공개 접두어가 붙은 시크릿 이름 (${PUBLIC_PREFIX}…${SECRET}…)`,
      pattern: new RegExp(`${PUBLIC_PREFIX}[A-Za-z0-9_]*${SECRET}`, 'i'),
      roots: allSource,
    },
    {
      name: `${SECRET_VARIABLE} 를 shop 앱이 이름으로도 알고 있다`,
      pattern: new RegExp(SECRET_VARIABLE),
      roots: shopSource,
    },
    {
      name: `시크릿 키 모양의 리터럴 (${KEY_PREFIXES.join(' · ')})`,
      // 접두어 뒤에 키 몸통이 있어야 걸린다. `.env.example` 처럼 「`test_sk_` 로
      // 시작한다」고 설명하는 산문은 유출이 아니다.
      pattern: new RegExp(`(?:${KEY_PREFIXES.join('|')})[A-Za-z0-9]{8,}`),
      roots: allSource,
    },
  ]
}

/** shop 앱이 스스로 컴파일하는 것 — 규칙 2 의 범위. */
const SHOP_SOURCE = [join(APP_ROOT, 'src'), join(APP_ROOT, 'next.config.ts')]

/**
 * 규칙 1·3 의 범위. 세 Next 앱과 그들이 트랜스파일하는 두 패키지, 그리고 키를 실제로
 * 읽는 `apps/api/src` 까지 — 두 규칙은 서버에서도 옳은 적이 없다.
 *
 * 패키지 경계를 넘는 것은 `packages/ui/test/component-tokens.spec.ts` 가 같은 이유로
 * 이미 하는 일이다: 규칙이 저장소 전체의 것인데 아무도 돌리지 않으면, 그 규칙은 이미
 * 어딘가에서 깨져 있다.
 */
const ALL_SOURCE = [
  ...SHOP_SOURCE,
  join(REPO_ROOT, 'apps', 'admin', 'src'),
  join(REPO_ROOT, 'apps', 'admin', 'next.config.ts'),
  join(REPO_ROOT, 'apps', 'seller', 'src'),
  join(REPO_ROOT, 'apps', 'seller', 'next.config.ts'),
  join(REPO_ROOT, 'apps', 'api', 'src'),
  join(REPO_ROOT, 'packages', 'ui', 'src'),
  join(REPO_ROOT, 'packages', 'shared', 'src'),
]

const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/
const SPEC_FILE = /\.spec\.(?:ts|tsx|js|jsx)$/

/** 루트는 디렉터리일 수도, `next.config.ts` 처럼 파일 하나일 수도 있다. */
function sourceFilesUnder(root: string): readonly string[] {
  if (statSync(root).isFile()) return [root]

  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && SOURCE_FILE.test(entry.name) && !SPEC_FILE.test(entry.name),
    )
    .map((entry) => join(entry.parentPath, entry.name))
}

/** 한 파일은 여러 규칙이 본다. 읽기는 한 번이면 된다. */
const contents = new Map<string, string>()

function read(file: string): string {
  const cached = contents.get(file)

  if (cached !== undefined) return cached

  const text = readFileSync(file, 'utf8')

  contents.set(file, text)
  return text
}

function findings(rules: readonly Rule[]): readonly Finding[] {
  return rules.flatMap((rule) =>
    rule.roots
      .flatMap(sourceFilesUnder)
      .filter((file) => rule.pattern.test(read(file)))
      .map((file) => ({ file: relative(REPO_ROOT, file).split(sep).join('/'), rule: rule.name })),
  )
}

describe('토스 시크릿 키는 브라우저 번들에 닿을 이름조차 갖지 않는다', () => {
  it('names no secret behind a public prefix, anywhere', () => {
    expect(findings(rulesOver(ALL_SOURCE, SHOP_SOURCE))).toEqual([])
  })

  it('scans every configured root', () => {
    // 경로 하나가 오타여도 `statSync` 가 던지지만, 존재하는데 비어 있는 루트는
    // 조용히 아무것도 재지 않는다. 검사가 검사하는 척만 하는 상태가 그것이다.
    const empty = ALL_SOURCE.filter((root) => sourceFilesUnder(root).length === 0)

    expect(empty).toEqual([])
  })
})

/**
 * 통과하는 검사만으로는 이 파일이 무엇을 잡는지 알 수 없다 — 잡을 것이 없어서
 * 초록인지, 못 잡아서 초록인지 구분이 안 된다. 그래서 임시 디렉터리에 실제로 잘못된
 * 파일을 써 놓고, **걷기부터 매칭까지 같은 경로**로 그것을 잡아내는 것을 본다
 * (`apps/api/test/db/stock-contention.spec.ts` 의 음성 대조군과 같은 이유다).
 *
 * 저장소 안이 아니라 임시 디렉터리인 이유: 이 검사가 지키는 `apps/shop/src` 에
 * 잘못된 파일을 잠깐이라도 쓰면, 그 사이에 도는 다른 검사가 그것을 본다.
 */
describe('이 검사는 실제로 빨개진다', () => {
  let scratch = ''
  let leak = ''
  let innocent = ''

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'secret-key-containment-'))
    leak = join(scratch, 'leak')
    innocent = join(scratch, 'innocent')

    mkdirSync(leak)
    mkdirSync(innocent)

    // 세 규칙을 한 파일로 전부 어긴다: 공개 접두어가 붙은 이름, 이름 자체,
    // 그리고 박아 넣은 키.
    writeFileSync(
      join(leak, 'checkout.ts'),
      [
        `export const inlined = process.env.${PUBLIC_PREFIX}${SECRET_VARIABLE}`,
        `export const named = process.env.${SECRET_VARIABLE}`,
        `export const hardcoded = '${KEY_PREFIXES[0]}0123456789abcdef'`,
      ].join('\n'),
    )

    // 지금 `apps/api/src/config/toss-config.ts` 에 있는 줄과 같은 모양. 공개 키와
    // 시크릿 이름이 한 줄에 나란히 있지만 **서로 다른 이름**이다.
    writeFileSync(
      join(innocent, 'toss-config.ts'),
      `const VARIABLES = ['${PUBLIC_PREFIX}TOSS_CLIENT_KEY', '${SECRET_VARIABLE}'] as const\n`,
    )
  })

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  it('flags a file that would inline the secret into the browser bundle', () => {
    const flagged = findings(rulesOver([leak], [leak]))

    expect(flagged.map((finding) => finding.rule)).toEqual(
      rulesOver([leak], [leak]).map((rule) => rule.name),
    )
    expect(flagged.every((finding) => finding.file.endsWith('checkout.ts'))).toBe(true)
  })

  it('leaves the public key and the secret name side by side alone', () => {
    // 규칙 1 만 겨눈다. 이 줄은 서버 설정에 있는 그대로이고, 여기서 걸린다면
    // 다음 사람이 고치는 것은 설정이 아니라 규칙이다.
    expect(findings(rulesOver([innocent], []))).toEqual([])
  })
})
