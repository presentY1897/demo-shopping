/**
 * The `details` → field convention.
 *
 * The strings in the "as the API sends them today" tests are not invented: they
 * are what `apps/api/src/common/parse-input.ts` builds from a zod issue and what
 * `all-exceptions.filter.ts` lets through — a Korean sentence whose first token
 * is the dotted field path. That filter drops every non-string entry, which is
 * why the structured shape below is marked as the one the backend does not send
 * yet (TASK-0017 4.5).
 */

import { describe, expect, it } from 'vitest'

import { serverFieldErrors } from './server-errors'

const FIELDS = ['name', 'slug', 'attributes', 'attributes.material']

describe('details as the API sends them today', () => {
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

describe('the structured shape the API does not send yet', () => {
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
      codeMessages: { SLUG_TAKEN: '이미 사용 중인 주소입니다' },
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
