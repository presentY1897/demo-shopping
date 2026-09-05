/**
 * 한글 자모 분해와 초성 추출 (TASK-0103).
 *
 * 한글 입력은 **조합 중 상태를 거친다.** 「코트」를 치는 동안 브라우저는 차례로
 * 「ㅋ」·「코」·「코ㅌ」·「코트」를 내놓고, 그중 「코ㅌ」는 유니코드로 완성형 `코` 뒤에
 * 호환 자모 `ㅌ` 가 붙은 것이라 「코트」와는 한 글자도 겹치지 않는다. 접두어 검색만으로는
 * 잡히지 않는 이유가 그것이다(D-013 이 말한 한국어 한계의 구체적 사례).
 *
 * 해결은 **양쪽을 같은 모양으로 만드는 것**이다 — 색인할 이름도, 입력된 검색어도 자모로
 * 펴 놓으면 「ㅋㅗㅌ」가 「ㅋㅗㅌㅡ」의 접두어가 된다.
 *
 * `packages/shared` 에 있는 이유: 색인을 만드는 쪽(`apps/api`)과 검색어를 보내는 쪽이 **반드시
 * 같은 함수**를 써야 한다. 두 벌이면 한쪽만 고쳐지는 날 아무것도 찾히지 않고, 그때 증상은
 * 「검색이 안 된다」이지 「두 구현이 갈렸다」가 아니다.
 */

/** `가`–`힣`. 완성형 음절이 놓인 구간. */
const SYLLABLE_START = 0xac00
const SYLLABLE_END = 0xd7a3

const MEDIAL_COUNT = 21
const FINAL_COUNT = 28

/**
 * 조합 표. **배열이 아니라 문자열이다.**
 *
 * `charAt` 은 범위를 벗어나도 `''` 를 돌려주므로 `string` 이지 `string | undefined` 가 아니다 —
 * 즉 **분기가 없다.** 배열로 두면 `?? ''` 같은 방어 코드가 붙는데, 그 분기는 `isSyllable` 을
 * 통과한 값으로는 **결코 닿을 수 없어** 커버리지에 영원한 구멍으로 남는다. 닿을 수 없는 방어는
 * 방어가 아니라 아무도 읽지 않는 주석이다.
 */
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

const MEDIALS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'

/** 첫 칸은 받침 없음이다. 공백을 놓고 `trim` 으로 지운다 — 그것도 분기가 아니다. */
const FINALS = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'

/** 호환 자모 구간 (`ㄱ`–`ㅣ`) — 조합 중 상태에서 홀로 나오는 글자들. */
const COMPAT_START = 0x3131
const COMPAT_END = 0x3163

/** 자음만 모아 둔 것. 초성 검색인지 가리는 데 쓴다. */
const COMPAT_CONSONANTS = new Set('ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ')

function isSyllable(code: number): boolean {
  return code >= SYLLABLE_START && code <= SYLLABLE_END
}

function isCompatJamo(code: number): boolean {
  return code >= COMPAT_START && code <= COMPAT_END
}

/**
 * 한 글자를 자모로 편다.
 *
 * 완성형은 초성·중성·종성으로 갈라지고, 이미 자모인 글자와 그 밖의 모든 것(영문·숫자·기호)은
 * 그대로 지나간다. **한글이 아닌 것을 버리지 않는 것이 중요하다** — 「나이ㅋ」 같은 입력이
 * 「나이키」를 찾아야 하고(F6), 버리면 영문 상품명이 통째로 사라진다.
 */
export function decomposeChar(char: string): string {
  const code = char.codePointAt(0)

  if (code === undefined || !isSyllable(code)) return char

  const offset = code - SYLLABLE_START
  const initial = Math.floor(offset / (MEDIAL_COUNT * FINAL_COUNT))
  const medial = Math.floor((offset % (MEDIAL_COUNT * FINAL_COUNT)) / FINAL_COUNT)
  const final = offset % FINAL_COUNT

  return `${INITIALS.charAt(initial)}${MEDIALS.charAt(medial)}${FINALS.charAt(final).trim()}`
}

/** 문자열 전체를 자모로 편다. 「울 롱코트」 → 「ㅇㅜㄹ ㄹㅗㅇㅋㅗㅌㅡ」. */
export function decomposeHangul(value: string): string {
  return [...value].map(decomposeChar).join('')
}

/**
 * 초성만 남긴다. 「울 롱코트」 → 「ㅇ ㄹㅋㅌ」.
 *
 * 한글이 아닌 글자는 그대로 남는다 — 「나이키 270」의 초성은 「ㄴㅇㅋ 270」이고, 숫자를 버리면
 * 그 상품을 초성으로 찾을 길이 없어진다.
 */
export function chosungOf(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.codePointAt(0)

      if (code === undefined || !isSyllable(code)) return char

      return INITIALS.charAt(Math.floor((code - SYLLABLE_START) / (MEDIAL_COUNT * FINAL_COUNT)))
    })
    .join('')
}

/**
 * 검색어의 종류.
 *
 * | | 언제 | 어디에 대고 찾나 |
 * | --- | --- | --- |
 * | `chosung` | 한글이 **전부 자음**이고 두 글자 이상 | 초성 필드 |
 * | `jamo` | 자모가 섞여 있다 — 조합 중 상태 | 자모 필드 |
 * | `complete` | 그 밖의 전부 | 원래 이름 |
 */
export type HangulQueryKind = 'complete' | 'jamo' | 'chosung'

/** R1: 초성 검색은 후보가 넓다. 한 글자로는 켜지 않는다. */
export const CHOSUNG_MIN_LENGTH = 2

/**
 * 검색어가 어느 길로 가야 하는지 가린다 (F4).
 *
 * **판별에 실패하면 `complete` 다** (R3). 그쪽이 기존 동작이고, 잘못 갈랐을 때 잃는 것이 가장
 * 적다 — 자모 필드에 완성형을 던지면 아무것도 안 나오지만, 이름 필드에 완성형을 던지는 것은
 * 그냥 평소의 검색이다.
 */
export function classifyHangulQuery(term: string): HangulQueryKind {
  const trimmed = term.trim()

  if (trimmed === '') return 'complete'

  const jamo = [...trimmed].filter((char) => {
    const code = char.codePointAt(0)

    return code !== undefined && isCompatJamo(code)
  })

  if (jamo.length === 0) return 'complete'

  // 자음만으로 이루어졌고 충분히 길면 초성 검색이다. 「ㅋㅌ」가 그것이고,
  // 「코ㅌ」는 완성형이 섞여 있으므로 자모 검색으로 간다.
  const onlyConsonants = jamo.every((char) => COMPAT_CONSONANTS.has(char))
  const hasSyllable = [...trimmed].some((char) => {
    const code = char.codePointAt(0)

    return code !== undefined && isSyllable(code)
  })

  if (onlyConsonants && !hasSyllable && jamo.length >= CHOSUNG_MIN_LENGTH) return 'chosung'

  return 'jamo'
}

/**
 * 검색어를 그 종류에 맞는 모양으로 바꾼다.
 *
 * 색인을 만들 때 쓴 함수를 그대로 쓴다 — 그래서 이 둘이 갈릴 수 없다.
 */
export function hangulQueryFor(term: string, kind: HangulQueryKind): string {
  if (kind === 'chosung') return term.trim()
  if (kind === 'jamo') return decomposeHangul(term.trim())

  return term.trim()
}

/**
 * 색인에 실을 보조 필드.
 *
 * **낱말 단위로 만든다** (4.1). 엔진은 접두어를 찾지 부분 문자열을 찾지 않으므로, 「울 롱코트」를
 * 한 덩어리로 이어 붙이면 「ㅋㅌ」로는 아무것도 못 찾는다 — 낱말로 나눠 두어야 「코트」의 초성이
 * 어느 낱말의 앞에 오게 된다.
 *
 * **상품명과 브랜드명에만** 쓴다 (R2). 설명 본문까지 펴면 인덱스가 몇 배가 되고, 설명을
 * 초성으로 찾는 사람은 없다.
 */
export function hangulIndexFields(values: readonly string[]): {
  readonly jamo: readonly string[]
  readonly chosung: readonly string[]
} {
  const words = values
    .flatMap((value) => value.split(/\s+/))
    .map((word) => word.trim())
    .filter((word) => word !== '')

  return {
    jamo: [...new Set(words.map(decomposeHangul))],
    chosung: [...new Set(words.map(chosungOf))],
  }
}
