/**
 * How this console turns a failure into words, and where it puts them.
 *
 * Pure logic — QUALITY-GATES Q5's 순수 로직 row, and `vitest.config.mjs` holds
 * both modules to 100% branch coverage. The reason is specific to TASK-0117: a
 * missed branch here does not produce a red test, it produces an error rendered
 * with the wrong sentence, in the wrong place, or with a UUID beside a message
 * that told the reader exactly what to do. All three still *look* like a working
 * error screen.
 */

import { ApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { ApiConfigurationError } from '@/lib/api'
import type { ApiFailure } from '@/lib/api-failure'
import { apiFailure, failureMessage, hasCode, quotableRequestId } from '@/lib/api-failure'
import { errorMessage, firstFieldError, interpolate, paramsOf } from '@/lib/errors'
import { messagesFor } from '@/messages'

const messages = messagesFor()
const catalog = { errors: messages.errors, failures: messages.categories.failures }

/** An `ApiClientError` shaped the way `createApiClient` shapes one. */
function httpError(options: {
  status: number
  code?: string
  message?: string
  details?: readonly unknown[]
  requestId?: string
  withBody?: boolean
}): ApiClientError {
  const withBody = options.withBody ?? true

  return new ApiClientError({
    kind: 'http',
    message: 'for the log',
    status: options.status,
    ...(withBody
      ? {
          body: {
            error: {
              code: options.code ?? 'INTERNAL_ERROR',
              message: options.message ?? '서버 문장',
              details: [...(options.details ?? [])],
              requestId: options.requestId ?? 'req-1',
            },
          },
        }
      : {}),
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
  })
}

describe('interpolate', () => {
  it('leaves a template with no placeholder alone', () => {
    expect(interpolate('이미 쓰고 있는 주소예요.')).toBe('이미 쓰고 있는 주소예요.')
  })

  it('fills a placeholder from the values the server sent', () => {
    expect(interpolate('{max}단계까지만', { max: 3 })).toBe('3단계까지만')
  })

  it('fills a text value as well as a number', () => {
    expect(interpolate("'{name}' 에 이미 있어요.", { name: '의류' })).toBe("'의류' 에 이미 있어요.")
  })

  it('gives up rather than printing a placeholder at somebody', () => {
    // "카테고리는 {max}단계까지만" would read as a bug in the product, and
    // dropping the placeholder silently would read as broken grammar.
    expect(interpolate('{max}단계까지만', { other: 3 })).toBeUndefined()
    expect(interpolate('{max}단계까지만')).toBeUndefined()
  })
})

describe('errorMessage', () => {
  it('answers with this console’s sentence for a code it knows', () => {
    expect(errorMessage(messages.errors, 'CATEGORY_SLUG_TAKEN')).toBe(
      messages.errors.CATEGORY_SLUG_TAKEN,
    )
  })

  it('answers nothing for a code from the future, so the caller can fall back', () => {
    expect(errorMessage(messages.errors, 'CODE_NOBODY_DECLARED')).toBeUndefined()
  })

  it('answers nothing when the sentence needs a value that did not arrive', () => {
    expect(errorMessage(messages.errors, 'CATEGORY_MAX_DEPTH')).toBeUndefined()
    expect(errorMessage(messages.errors, 'CATEGORY_MAX_DEPTH', { max: 3 })).toBe(
      '카테고리는 3단계까지만 만들 수 있어요.',
    )
  })
})

describe('reading the details', () => {
  it('finds the first structured entry and ignores the strings around it', () => {
    const details = ['앞의 문자열', { field: 'slug', message: 'a', params: { max: 3 } }]

    expect(firstFieldError(details)).toMatchObject({ field: 'slug' })
    expect(paramsOf(details)).toEqual({ max: 3 })
  })

  it('answers nothing when nothing structured came', () => {
    expect(firstFieldError(['문자열만'])).toBeUndefined()
    expect(paramsOf(['문자열만'])).toBeUndefined()
  })

  it('answers nothing when the entry carries no values to interpolate', () => {
    expect(paramsOf([{ field: 'slug', message: 'a' }])).toBeUndefined()
  })
})

describe('classifying what was thrown', () => {
  it('recognises a missing API URL', () => {
    expect(apiFailure(new ApiConfigurationError('no url'))).toEqual({
      kind: 'transport',
      reason: 'configuration',
    })
  })

  it('calls anything it does not recognise unknown rather than guessing', () => {
    expect(apiFailure(new Error('boom'))).toEqual({ kind: 'transport', reason: 'unknown' })
  })

  it('carries a transport kind straight through', () => {
    const error = new ApiClientError({ kind: 'network', message: 'unreachable' })

    expect(apiFailure(error)).toEqual({ kind: 'transport', reason: 'network' })
  })

  it('treats an unreadable error response as transport, not as an answer', () => {
    // A proxy's HTML error page: the status arrived, the envelope did not, and
    // there is no code to branch on.
    const failure = apiFailure(httpError({ status: 502, withBody: false }))

    expect(failure).toEqual({ kind: 'transport', reason: 'malformed_response' })
  })

  it('keeps everything the envelope carried', () => {
    const failure = apiFailure(
      httpError({
        status: 409,
        code: 'CATEGORY_SLUG_TAKEN',
        message: '서버 문장',
        details: [{ field: 'slug', message: '서버 문장', code: 'CATEGORY_SLUG_TAKEN' }],
        requestId: 'req-42',
      }),
    )

    expect(failure).toMatchObject({
      kind: 'http',
      status: 409,
      code: 'CATEGORY_SLUG_TAKEN',
      requestId: 'req-42',
    })
  })

  it('survives a client error with no status of its own', () => {
    const error = new ApiClientError({
      kind: 'http',
      message: 'for the log',
      body: { error: { code: 'CONFLICT', message: 'a', details: [], requestId: 'r' } },
    })

    expect(apiFailure(error)).toMatchObject({ status: 0 })
  })
})

describe('hasCode', () => {
  it('is false for a failure that never reached the API', () => {
    expect(hasCode({ kind: 'transport', reason: 'network' }, 'CATEGORY_SLUG_TAKEN')).toBe(false)
  })

  it('separates two codes that share a status', () => {
    const slug = apiFailure(httpError({ status: 409, code: 'CATEGORY_SLUG_TAKEN' }))
    const version = apiFailure(httpError({ status: 409, code: 'CATEGORY_VERSION_CONFLICT' }))

    expect(hasCode(slug, 'CATEGORY_SLUG_TAKEN')).toBe(true)
    expect(hasCode(version, 'CATEGORY_SLUG_TAKEN')).toBe(false)
  })
})

describe('failureMessage', () => {
  it('uses the transport catalog when nothing arrived', () => {
    const failure: ApiFailure = { kind: 'transport', reason: 'timeout' }

    expect(failureMessage(failure, catalog)).toBe(messages.categories.failures.timeout)
  })

  it('uses this console’s sentence, not the server’s', () => {
    const failure = apiFailure(
      httpError({
        status: 409,
        code: 'CATEGORY_SLUG_TAKEN',
        message: '이미 사용 중인 슬러그입니다.',
      }),
    )

    expect(failureMessage(failure, catalog)).toBe(messages.errors.CATEGORY_SLUG_TAKEN)
  })

  it('interpolates from the values the failure carried', () => {
    const failure = apiFailure(
      httpError({
        status: 400,
        code: 'CATEGORY_MAX_DEPTH',
        details: [{ field: 'parentId', message: '서버 문장', params: { max: 3 } }],
      }),
    )

    expect(failureMessage(failure, catalog)).toBe('카테고리는 3단계까지만 만들 수 있어요.')
  })

  it('falls back to the server’s sentence for a code it has never heard of', () => {
    const failure = apiFailure(
      httpError({ status: 409, code: 'CODE_FROM_THE_FUTURE', message: '서버만 아는 문장' }),
    )

    // An empty error is worse than a server-worded one (TASK-0117 4.1).
    expect(failureMessage(failure, catalog)).toBe('서버만 아는 문장')
  })
})

describe('quotableRequestId', () => {
  it('offers nothing for a failure that produced no response', () => {
    expect(quotableRequestId({ kind: 'transport', reason: 'network' })).toBeNull()
  })

  it('offers nothing for a failure the reader can act on', () => {
    const failure = apiFailure(
      httpError({ status: 409, code: 'CATEGORY_SLUG_TAKEN', requestId: 'req-7' }),
    )

    // The next action is already on screen; a UUID beside it is noise, and it
    // suggests the problem is ours (TASK-0117 R2).
    expect(quotableRequestId(failure)).toBeNull()
  })

  it('offers the id for a failure only we can fix', () => {
    const failure = apiFailure(
      httpError({ status: 500, code: 'INTERNAL_ERROR', requestId: 'req-7' }),
    )

    expect(quotableRequestId(failure)).toBe('req-7')
  })
})

describe('문구를 바꿔도 화면이 같은 판단을 한다 (F3)', () => {
  /** The same three refusals, worded twice. Only the prose differs. */
  const wordings = [
    {
      label: '지금 서버가 쓰는 문구',
      slug: '이미 쓰고 있는 주소예요. 다른 주소를 입력해 주세요.',
      version: '다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요?',
      children: '하위 카테고리를 먼저 옮기거나 삭제해 주세요.',
    },
    {
      label: '전부 다른 말로 바꾼 문구',
      slug: '그 주소는 이미 쓰이고 있어요.',
      version: '먼저 저장된 내용이 있어요.',
      children: '아래에 남아 있는 항목이 있어요.',
    },
  ] as const

  it.each(wordings)('$label 에서도 코드로 구분한다', (wording) => {
    const slug = apiFailure(
      httpError({ status: 409, code: 'CATEGORY_SLUG_TAKEN', message: wording.slug }),
    )
    const version = apiFailure(
      httpError({ status: 409, code: 'CATEGORY_VERSION_CONFLICT', message: wording.version }),
    )
    const children = apiFailure(
      httpError({ status: 409, code: 'CATEGORY_HAS_CHILDREN', message: wording.children }),
    )

    expect(hasCode(slug, 'CATEGORY_SLUG_TAKEN')).toBe(true)
    expect(hasCode(version, 'CATEGORY_VERSION_CONFLICT')).toBe(true)
    expect(hasCode(children, 'CATEGORY_HAS_CHILDREN')).toBe(true)

    // And the words on screen are ours in every case, whatever the server said.
    expect(failureMessage(slug, catalog)).toBe(messages.errors.CATEGORY_SLUG_TAKEN)
    expect(failureMessage(version, catalog)).toBe(messages.errors.CATEGORY_VERSION_CONFLICT)
    expect(failureMessage(children, catalog)).toBe(messages.errors.CATEGORY_HAS_CHILDREN)
  })
})
