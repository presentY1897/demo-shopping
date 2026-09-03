/**
 * The `details` → field convention.
 *
 * Two shapes arrive, and the whole point of TASK-0117 is which one wins. The
 * structured entries are what `apps/api/src/common/parse-input.ts` now builds
 * from a zod issue and what the catalog services attach to a domain failure;
 * the bare strings are what an endpoint that has not been given codes still
 * sends, and what every endpoint sent before.
 *
 * **The negative control lives in this file.** `문구를 바꿔도` below rewrites
 * every sentence into something unrecognisable and asserts that the placement
 * does not move. That is TASK-0117 F3 at the unit level: what a form does with
 * a failure must be a function of `field` and `code`, never of the prose.
 */

import { describe, expect, it } from 'vitest'

import { serverFieldErrors } from './server-errors'

const FIELDS = ['name', 'slug', 'attributes', 'attributes.material']

describe('details from an endpoint that has no codes yet', () => {
  it('places a message whose first token is a field name', () => {
    const result = serverFieldErrors(['slug 값이 올바르지 않습니다.'], { fields: FIELDS })

    expect(result.fieldErrors).toEqual({ slug: 'slug 값이 올바르지 않습니다.' })
    expect(result.formErrors).toEqual([])
  })

  it('prefers the longest matching path so a nested field beats its parent', () => {
    const result = serverFieldErrors(['attributes.material 값이 올바르지 않습니다.'], {
      fields: FIELDS,
    })

    expect(Object.keys(result.fieldErrors)).toEqual(['attributes.material'])
  })

  it('places an array index under the field it belongs to', () => {
    const result = serverFieldErrors(['attributes.0 값이 올바르지 않습니다.'], {
      fields: ['attributes'],
    })

    expect(result.fieldErrors).toEqual({ attributes: 'attributes.0 값이 올바르지 않습니다.' })
  })

  it('shows a message that starts with whitespace at the form level', () => {
    const result = serverFieldErrors([' slug 값이 올바르지 않습니다.'], { fields: FIELDS })

    expect(result.fieldErrors).toEqual({})
    expect(result.formErrors).toEqual([' slug 값이 올바르지 않습니다.'])
  })

  it('shows a message it cannot place rather than dropping it', () => {
    const result = serverFieldErrors(['요청 값이 올바르지 않습니다.'], { fields: FIELDS })

    expect(result.fieldErrors).toEqual({})
    expect(result.formErrors).toEqual(['요청 값이 올바르지 않습니다.'])
  })

  it('keeps the first message when a field is reported twice', () => {
    const result = serverFieldErrors(['slug 첫 번째', 'slug 두 번째'], { fields: FIELDS })

    expect(result.fieldErrors).toEqual({ slug: 'slug 첫 번째' })
  })

  it('ignores entries that carry nothing to show', () => {
    const result = serverFieldErrors(['', 42, null, undefined, { stack: ['a', 'b'] }], {
      fields: FIELDS,
    })

    expect(result).toEqual({ fieldErrors: {}, formErrors: [] })
  })
})

describe('the structured shape the API sends today', () => {
  it('reads `field` and `message`', () => {
    const result = serverFieldErrors([{ field: 'name', message: '이미 사용 중인 이름입니다' }], {
      fields: FIELDS,
    })

    expect(result.fieldErrors).toEqual({ name: '이미 사용 중인 이름입니다' })
  })

  it('reads `path` as a dotted string', () => {
    const result = serverFieldErrors([{ message: '형식이 올바르지 않습니다', path: 'slug' }], {
      fields: FIELDS,
    })

    expect(result.fieldErrors).toEqual({ slug: '형식이 올바르지 않습니다' })
  })

  it('reads `path` as the array a zod issue carries', () => {
    const result = serverFieldErrors(
      [{ message: '소재를 입력해주세요', path: ['attributes', 'material'] }],
      { fields: FIELDS },
    )

    expect(result.fieldErrors).toEqual({ 'attributes.material': '소재를 입력해주세요' })
  })

  it('moves a message about an unknown field to the form level', () => {
    const result = serverFieldErrors([{ field: 'unknown', message: '알 수 없는 필드' }], {
      fields: FIELDS,
    })

    expect(result.fieldErrors).toEqual({})
    expect(result.formErrors).toEqual(['알 수 없는 필드'])
  })

  it('ignores an object with no message to show', () => {
    const result = serverFieldErrors([{ field: 'name' }, { message: '', path: [] }], {
      fields: FIELDS,
    })

    expect(result).toEqual({ fieldErrors: {}, formErrors: [] })
  })

  it('ignores an object whose message names nothing', () => {
    const result = serverFieldErrors(
      [
        { message: '어디에도 붙지 않는 오류' },
        { field: '', message: 'a' },
        { message: 'b', path: [] },
      ],
      { fields: FIELDS },
    )

    expect(result).toEqual({ fieldErrors: {}, formErrors: [] })
  })
})

describe('errors only the server can detect', () => {
  it('places a code on the field the caller maps it to', () => {
    const result = serverFieldErrors([], {
      code: 'SLUG_TAKEN',
      codeFields: { SLUG_TAKEN: 'slug' },
      messageForCode: (code) => (code === 'SLUG_TAKEN' ? '이미 사용 중인 주소입니다' : undefined),
      fields: FIELDS,
    })

    expect(result.fieldErrors).toEqual({ slug: '이미 사용 중인 주소입니다' })
  })

  it('uses the fallback copy when the code has no message of its own', () => {
    const result = serverFieldErrors([], {
      code: 'SLUG_TAKEN',
      codeFields: { SLUG_TAKEN: 'slug' },
      fallbackMessage: '저장하지 못했습니다',
      fields: FIELDS,
    })

    expect(result.fieldErrors).toEqual({ slug: '저장하지 못했습니다' })
  })

  it('places nothing when the code maps to a field but there is no copy for it', () => {
    const result = serverFieldErrors([], {
      code: 'SLUG_TAKEN',
      codeFields: { SLUG_TAKEN: 'slug' },
      fields: FIELDS,
    })

    expect(result).toEqual({ fieldErrors: {}, formErrors: [] })
  })

  it('ignores a code nobody mapped', () => {
    const result = serverFieldErrors([], {
      code: 'UNMAPPED',
      codeFields: { SLUG_TAKEN: 'slug' },
      fields: FIELDS,
    })

    expect(result).toEqual({ fieldErrors: {}, formErrors: [] })
  })

  it('ignores a missing code', () => {
    const result = serverFieldErrors([], { code: null, fields: FIELDS })

    expect(result).toEqual({ fieldErrors: {}, formErrors: [] })
  })

  it('leaves the fallback out when the details already said something', () => {
    const result = serverFieldErrors(['slug 값이 올바르지 않습니다.'], {
      fallbackMessage: '저장하지 못했습니다',
      fields: FIELDS,
    })

    expect(result.formErrors).toEqual([])
  })

  it('shows the fallback when nothing at all could be placed', () => {
    const result = serverFieldErrors([], {
      fallbackMessage: '저장하지 못했습니다',
      fields: FIELDS,
    })

    expect(result.formErrors).toEqual(['저장하지 못했습니다'])
  })
})

describe("the app's catalog decides the words (TASK-0117 4.5)", () => {
  const catalog: Record<string, string> = {
    CATEGORY_SLUG_TAKEN: '이미 쓰고 있는 주소예요. 다른 주소를 입력해 주세요.',
  }

  it('prefers the catalog sentence over the one the server sent', () => {
    const result = serverFieldErrors(
      [{ field: 'slug', message: '서버가 보낸 문장', code: 'CATEGORY_SLUG_TAKEN' }],
      { fields: FIELDS, messageForCode: (code) => catalog[code] },
    )

    expect(result.fieldErrors).toEqual({ slug: catalog.CATEGORY_SLUG_TAKEN })
  })

  it("falls back to the server's sentence for a code the catalog never heard of", () => {
    const result = serverFieldErrors(
      [{ field: 'slug', message: '서버가 보낸 문장', code: 'CODE_FROM_THE_FUTURE' }],
      { fields: FIELDS, messageForCode: (code) => catalog[code] },
    )

    // An empty error is worse than a server-worded one.
    expect(result.fieldErrors).toEqual({ slug: '서버가 보낸 문장' })
  })

  it("uses the server's sentence when the caller brought no catalog at all", () => {
    const result = serverFieldErrors(
      [{ field: 'slug', message: '서버가 보낸 문장', code: 'CATEGORY_SLUG_TAKEN' }],
      { fields: FIELDS },
    )

    expect(result.fieldErrors).toEqual({ slug: '서버가 보낸 문장' })
  })

  it('hands the catalog the values it has to interpolate', () => {
    const result = serverFieldErrors(
      [
        {
          field: 'name',
          message: '서버 문장',
          code: 'CATEGORY_MAX_DEPTH',
          params: { max: 3 },
        },
      ],
      {
        fields: FIELDS,
        messageForCode: (code, params) =>
          code === 'CATEGORY_MAX_DEPTH'
            ? `카테고리는 ${String(params?.max)}단계까지만 만들 수 있어요.`
            : undefined,
      },
    )

    expect(result.fieldErrors).toEqual({ name: '카테고리는 3단계까지만 만들 수 있어요.' })
  })

  it('ignores a params bag that is not an object', () => {
    const seen: unknown[] = []

    serverFieldErrors(
      [
        { field: 'name', message: 'a', code: 'X', params: 'nope' },
        { field: 'slug', message: 'b', code: 'X', params: ['nope'] },
        { field: 'attributes', message: 'c', code: 'X', params: null },
      ],
      {
        fields: FIELDS,
        messageForCode: (_code, params) => {
          seen.push(params)
          return undefined
        },
      },
    )

    expect(seen).toEqual([undefined, undefined, undefined])
  })

  it('ignores a code that is not a non-empty string', () => {
    const result = serverFieldErrors(
      [
        { field: 'name', message: '문장 A', code: '' },
        { field: 'slug', message: '문장 B', code: 42 },
      ],
      { fields: FIELDS, messageForCode: () => '카탈로그 문장' },
    )

    expect(result.fieldErrors).toEqual({ name: '문장 A', slug: '문장 B' })
  })
})

describe('문구를 바꿔도 매핑이 유지된다 (F3)', () => {
  /**
   * The same failures, worded twice. Nothing but the prose differs — the field
   * paths, the codes and the order are identical, exactly as TASK-0117 4.8's
   * script rewrites the server.
   */
  const asShipped = [
    { field: 'slug', message: 'slug 값이 올바르지 않습니다.', code: 'INVALID' },
    { field: 'name', message: 'name 값이 올바르지 않습니다.', code: 'INVALID' },
  ]
  const reworded = [
    { field: 'slug', message: '입력하신 내용을 다시 확인해 주세요. (slug)', code: 'INVALID' },
    { field: 'name', message: '적어주신 값을 다시 봐주세요. (name)', code: 'INVALID' },
  ]

  it('places both wordings on the same fields', () => {
    const before = serverFieldErrors(asShipped, { fields: FIELDS })
    const after = serverFieldErrors(reworded, { fields: FIELDS })

    expect(Object.keys(after.fieldErrors)).toEqual(Object.keys(before.fieldErrors))
    expect(after.formErrors).toEqual([])
  })

  it('places a rewording that no longer starts with the field name', () => {
    // The exact break TASK-0117 1장 describes: the leading token is gone, and
    // the old reader would have moved this to the top of the form.
    const result = serverFieldErrors(reworded, { fields: FIELDS })

    expect(result.fieldErrors.slug).toBe(reworded[0]?.message)
  })

  it('stops guessing at strings once the server has named an input', () => {
    const result = serverFieldErrors(
      [
        { field: 'slug', message: '주소를 확인해 주세요', code: 'CATEGORY_SLUG_TAKEN' },
        // Reads like a message about `name`, and is not one. Guessing here
        // could only contradict the entry above it.
        'name 값이 올바르지 않습니다.',
      ],
      { fields: FIELDS },
    )

    expect(result.fieldErrors).toEqual({ slug: '주소를 확인해 주세요' })
    // Not dropped: losing an error is worse than showing it unplaced.
    expect(result.formErrors).toEqual(['name 값이 올바르지 않습니다.'])
  })
})
