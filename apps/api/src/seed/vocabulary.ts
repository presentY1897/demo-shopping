import type { SeededRandom } from './random.js'

/**
 * The words the catalogue is made of (TASK-0037 4장, F6).
 *
 * **Brands are a list; product names are generated. That split is deliberate.**
 *
 * F6 — "실제 브랜드명 0건" — is verified by *reading*. Fifteen names can be read
 * and signed off in a minute; eight hundred generated names cannot, and a
 * generator that happens to emit a real brand would put a trademark into a
 * public repository with nobody having looked at it. So the fifteen stores are
 * written out below, coined from ordinary Korean words in combinations no
 * clothing label uses, and the generator is kept for the part where the volume
 * makes review impossible and the risk is not there: product names are 품목 +
 * 수식어, and neither pool contains a name at all.
 *
 * **Nothing here is drawn from `Math.random`.** Every function takes a
 * {@link SeededRandom}, so a rerun of `pnpm db:seed` regenerates the same
 * catalogue and can recognise what it wrote (F2).
 */

/**
 * The fifteen stores.
 *
 * Coined, and coined in a specific way: each is two ordinary Korean words —
 * 물결·소리, 해뜰·녘 — joined into a compound that reads as a name but is not
 * one. The slug is the romanisation, which is what a store URL would be.
 */
export const SEED_BRANDS: readonly (readonly [name: string, slug: string])[] = [
  ['해뜰녘', 'haetteulnyeok'],
  ['물결소리', 'mulgyeolsori'],
  ['서리나무', 'seorinamu'],
  ['늦여름자락', 'neujyeoreum'],
  ['바람의결', 'baramuigyeol'],
  ['오래된오후', 'oraedoenohu'],
  ['숲과창', 'supgwachang'],
  ['느린오전', 'neurinojeon'],
  ['첫눈자리', 'cheotnunjari'],
  ['모래시계공방', 'moraesigye'],
  ['담담상점', 'damdamsangjeom'],
  ['빛나는겨울', 'binnaneun'],
  ['둥근모서리', 'dunggeun'],
  ['잔잔한파도', 'janjanhan'],
  ['긴하루끝', 'ginharukkeut'],
]

/** What each store says about itself, drawn beside its name. */
const INTRODUCTION_OPENERS = [
  '매일 입는 옷이 가장 오래 남는다고 믿습니다.',
  '한 벌을 오래 입는 쪽을 택했습니다.',
  '유행보다 앞뒤가 맞는 옷을 만듭니다.',
  '군더더기를 덜어내는 데 시간을 씁니다.',
  '소재를 먼저 정하고 형태를 나중에 정합니다.',
] as const

const INTRODUCTION_CLOSERS = [
  '작은 공방에서 소량으로 만듭니다.',
  '한 시즌에 열 벌을 넘기지 않습니다.',
  '수선과 교환을 오래 받습니다.',
  '남은 원단은 다음 해에 다시 씁니다.',
  '만든 사람의 이름을 라벨에 적습니다.',
] as const

export function storeIntroduction(random: SeededRandom): string {
  return `${random.pick(INTRODUCTION_OPENERS)} ${random.pick(INTRODUCTION_CLOSERS)}`
}

/**
 * 품목 — the noun a product *is*, by leaf category.
 *
 * Keyed by the leaf slug so that a 스커트 is never named "청바지". R2 of the task
 * asks exactly this: the image pool and the name both hang off the category, so
 * at minimum the garment matches even when nothing else does.
 */
const NOUNS: Readonly<Record<string, readonly string[]>> = {
  'women-tops-tshirts': ['반팔 티셔츠', '긴팔 티셔츠', '슬리브리스 탑', '크롭 티셔츠'],
  'women-tops-blouses': ['셔츠 블라우스', '실크 블라우스', '카라 블라우스', '퍼프 블라우스'],
  'women-tops-knits': ['라운드 니트', '브이넥 니트', '가디건', '터틀넥 니트'],
  'women-bottoms-jeans': ['와이드 데님', '스트레이트 데님', '슬림 데님', '크롭 데님'],
  'women-bottoms-skirts': ['플리츠 스커트', 'A라인 스커트', '랩 스커트', '미디 스커트'],
  'women-bottoms-slacks': ['테이퍼드 슬랙스', '와이드 슬랙스', '크롭 슬랙스'],
  'women-outer-coats': ['싱글 코트', '더블 코트', '발마칸 코트', '숏 코트'],
  'women-outer-jackets': ['데님 재킷', '블레이저', '무스탕 재킷', '바람막이'],
  'women-shoes-sneakers': ['로우탑 스니커즈', '하이탑 스니커즈', '레트로 러너'],
  'women-shoes-boots': ['첼시 부츠', '앵클 부츠', '롱 부츠'],
  'women-bags-shoulder': ['숄더백', '호보백', '바게트백'],
  'women-bags-backpacks': ['백팩', '데이팩', '미니 백팩'],
  'women-accessories-hats': ['버킷햇', '볼캡', '베레모'],
  'men-tops-tshirts': ['반팔 티셔츠', '긴팔 티셔츠', '헨리넥 티셔츠', '포켓 티셔츠'],
  'men-tops-shirts': ['옥스퍼드 셔츠', '린넨 셔츠', '체크 셔츠', '밴드카라 셔츠'],
  'men-tops-knits': ['라운드 니트', '브이넥 니트', '가디건', '터틀넥 니트'],
  'men-bottoms-jeans': ['스트레이트 데님', '테이퍼드 데님', '와이드 데님'],
  'men-bottoms-slacks': ['테이퍼드 슬랙스', '와이드 슬랙스', '치노 팬츠'],
  'men-bottoms-shorts': ['치노 쇼츠', '데님 쇼츠', '스웨트 쇼츠'],
  'men-outer-coats': ['싱글 코트', '더블 코트', '발마칸 코트'],
  'men-outer-jackets': ['블루종', '블레이저', '코치 재킷', '바람막이'],
  'men-shoes-sneakers': ['로우탑 스니커즈', '하이탑 스니커즈', '레트로 러너'],
  'men-shoes-dress-shoes': ['더비 슈즈', '로퍼', '몽크 스트랩'],
  'men-bags-backpacks': ['백팩', '데이팩', '롤탑 백팩'],
  'men-bags-cross': ['크로스백', '메신저백', '슬링백'],
  'men-accessories-hats': ['볼캡', '버킷햇', '비니'],
}

/** 수식어 — the adjective in front. Shared, because a fabric is a fabric. */
const MODIFIERS = [
  '데일리',
  '베이식',
  '미니멀',
  '스탠다드',
  '클래식',
  '소프트',
  '경량',
  '워시드',
  '빈티지',
  '오버핏',
  '세미오버',
  '슬림핏',
] as const

/** A second, optional modifier — used often enough to vary the rhythm. */
const SEASONS = ['봄가을', '여름', '겨울', '사계절'] as const

/**
 * One product name for a leaf category.
 *
 * `[계절?] [수식어] [품목]`. The season is dropped about half the time so the
 * list does not read like a template — which it is, but a catalogue where every
 * single row has the same three-part rhythm looks generated at a glance and
 * that is exactly the impression this data exists to avoid.
 */
export function productName(random: SeededRandom, leafSlug: string): string {
  const nouns = NOUNS[leafSlug]

  if (nouns === undefined) throw new Error(`품목 어휘가 없는 카테고리입니다: ${leafSlug}`)

  const parts = [
    ...(random.chance(0.45) ? [random.pick(SEASONS)] : []),
    random.pick(MODIFIERS),
    random.pick(nouns),
  ]

  return parts.join(' ')
}

/** Every leaf slug this module can name a product for. */
export function namedLeafSlugs(): readonly string[] {
  return Object.keys(NOUNS)
}

const DESCRIPTION_BODIES = [
  '몸에 닿는 면을 먼저 생각해 원단을 골랐습니다.',
  '세탁 후에도 형태가 크게 흐트러지지 않도록 조직을 조였습니다.',
  '시접을 안쪽으로 접어 마감해 겉면이 깔끔합니다.',
  '한 사이즈 위를 골라도 어색하지 않은 여유를 뒀습니다.',
  '색이 빠지지 않도록 염색 후 한 번 더 헹궈 냅니다.',
  '무게를 줄이려고 안감을 절반만 넣었습니다.',
] as const

const DESCRIPTION_CARE = [
  '30도 이하 물에서 단독 세탁을 권합니다.',
  '드라이클리닝을 권합니다.',
  '뒤집어 세탁하면 더 오래 입을 수 있습니다.',
  '건조기 사용은 피해 주세요.',
] as const

/**
 * Two or three sentences, ending with how to wash it.
 *
 * Composed rather than fixed: 800 listings sharing one paragraph is worse than
 * no paragraph, because it tells a reader the data is filler in a way an empty
 * field does not.
 */
export function productDescription(random: SeededRandom, name: string): string {
  const bodies = random.sample(DESCRIPTION_BODIES, random.int(1, 2))

  return [`${name} 입니다.`, ...bodies, random.pick(DESCRIPTION_CARE)].join(' ')
}
