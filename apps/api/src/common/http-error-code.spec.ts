import { describe, expect, it } from 'vitest'

import { mappingForStatus } from './http-error-code.js'

describe('mappingForStatus', () => {
  it('maps the statuses the API produces today', () => {
    expect(mappingForStatus(404).code).toBe('NOT_FOUND')
    expect(mappingForStatus(422).code).toBe('VALIDATION_FAILED')
    expect(mappingForStatus(503).code).toBe('SERVICE_UNAVAILABLE')
  })

  it('falls back by class so an unmapped status is still typed', () => {
    expect(mappingForStatus(418).code).toBe('BAD_REQUEST')
    expect(mappingForStatus(504).code).toBe('INTERNAL_ERROR')
  })

  it('keeps every message in Korean and free of framework wording', () => {
    for (const status of [400, 401, 403, 404, 409, 418, 500, 503]) {
      const { message } = mappingForStatus(status)

      expect(message).toMatch(/[가-힣]/)
      expect(message).not.toMatch(/[A-Za-z]{4,}/)
    }
  })
})
