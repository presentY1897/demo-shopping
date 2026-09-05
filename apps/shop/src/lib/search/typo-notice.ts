import type { SearchHit } from '@shopping/shared'

/**
 * 「오타를 내도 결과가 나오고, 무엇으로 찾았는지 알려 준다」 (TASK-0041 F6).
 *
 * The engine corrects typos **silently**: `searchResponseSchema` carries items,
 * facets, a total and a cursor, and nothing that says "you typed 레트루 and I
 * searched 레트로". So the screen cannot repeat a correction it was never told
 * about — and inventing one would be worse than saying nothing, because a
 * guessed correction printed as fact is a lie the visitor has no way to check.
 *
 * What the screen *can* establish from the response alone is this: a word that
 * was typed appears literally in none of the results that came back. That can
 * only happen when the match was approximate, and it is exactly the fact worth
 * telling — 「입력하신 말과 똑같은 이름은 없었고, 비슷한 것으로 찾았습니다」.
 * The notice names the word so a person who genuinely meant it can see that it
 * was the word that got bent, and search again.
 *
 * Deliberately **not** a similarity score. The threshold that would need is the
 * engine's, TASK-0039 measured that it does not behave the way a character
 * count suggests (한 음절 틀린 「코투」는 어느 설정에서도 코트를 못 찾는다),
 * and a second, different notion of "close enough" living in the browser would
 * disagree with the one doing the searching.
 */

/** Where a literal match could have been seen. Mirrors `SEARCHABLE_ATTRIBUTES`. */
function haystack(hit: SearchHit): string {
  return `${hit.name} ${hit.brandName}`.toLowerCase()
}

/**
 * The typed words that appear in no result.
 *
 * Empty when the search was literal, when nothing was typed, or when nothing
 * came back — a zero-result search is F7's empty state and has nothing to
 * explain about corrections.
 */
export function unmatchedTerms(term: string, hits: readonly SearchHit[]): readonly string[] {
  if (hits.length === 0) return []

  const words = term
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')

  if (words.length === 0) return []

  const texts = hits.map(haystack)

  return words.filter((word) => !texts.some((text) => text.includes(word)))
}

/** Whether the notice should be shown at all. */
export function matchedApproximately(term: string, hits: readonly SearchHit[]): boolean {
  return unmatchedTerms(term, hits).length > 0
}
