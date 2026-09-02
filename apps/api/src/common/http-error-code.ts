import type { HttpErrorCode } from '@shopping/shared'

interface StatusMapping {
  readonly code: HttpErrorCode
  /** Shown to the end user, so Korean and free of implementation detail. */
  readonly message: string
}

const BY_STATUS = new Map<number, StatusMapping>([
  [400, { code: 'BAD_REQUEST', message: '요청 형식이 올바르지 않습니다.' }],
  [401, { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' }],
  [403, { code: 'FORBIDDEN', message: '이 작업을 수행할 권한이 없습니다.' }],
  [404, { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' }],
  [405, { code: 'METHOD_NOT_ALLOWED', message: '허용되지 않은 요청 방식입니다.' }],
  [409, { code: 'CONFLICT', message: '다른 요청과 충돌해 처리하지 못했습니다.' }],
  [413, { code: 'PAYLOAD_TOO_LARGE', message: '요청 본문이 너무 큽니다.' }],
  [415, { code: 'UNSUPPORTED_MEDIA_TYPE', message: '지원하지 않는 형식입니다.' }],
  [422, { code: 'VALIDATION_FAILED', message: '입력값을 확인해주세요.' }],
  [429, { code: 'TOO_MANY_REQUESTS', message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }],
  [503, { code: 'SERVICE_UNAVAILABLE', message: '일시적으로 서비스를 이용할 수 없습니다.' }],
])

const CLIENT_FALLBACK: StatusMapping = {
  code: 'BAD_REQUEST',
  message: '요청을 처리할 수 없습니다.',
}

const SERVER_FALLBACK: StatusMapping = {
  code: 'INTERNAL_ERROR',
  message: '서버 내부 오류가 발생했습니다.',
}

/**
 * Maps an HTTP status onto the error code and user message of the shared error
 * envelope.
 *
 * The message deliberately does not come from the thrown exception: framework
 * messages are English, leak internals, and change between versions. Anything
 * the caller genuinely needs goes into `details` instead.
 */
export function mappingForStatus(status: number): StatusMapping {
  return BY_STATUS.get(status) ?? (status >= 500 ? SERVER_FALLBACK : CLIENT_FALLBACK)
}
