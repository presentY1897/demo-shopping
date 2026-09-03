import { describe, expect, it } from 'vitest'

import type { UploadRuleResult } from './upload-rules.js'
import { extensionOf, productImageKey, resolveUploadExtension } from './upload-rules.js'

/**
 * The upload rules, exercised as pure input → output (QUALITY-GATES Q5, 순수
 * 로직). Every refusal below is a 400 the endpoint hands back verbatim, so the
 * assertions are on the sentence a person will read.
 */

/** The refusal sentence, or a failure when the rules let the file through. */
function refusalFor(result: UploadRuleResult): string {
  if (result.ok) throw new Error('거부될 것으로 기대했지만 통과했습니다.')

  return result.reason
}

const SELLER = '0192f0c1-0000-7000-8000-0000000a0001'
const OBJECT = '0192f0c2-0000-7000-8000-0000000b0002'

describe('extensionOf', () => {
  it('takes what follows the last dot, lowercased', () => {
    expect(extensionOf('사진.PNG')).toBe('png')
    expect(extensionOf('a.tar.gz')).toBe('gz')
  })

  it('finds nothing in a name without a dot', () => {
    expect(extensionOf('photo')).toBeNull()
  })

  it('treats a leading dot as part of the name, not an extension', () => {
    // Otherwise `.png` would be an upload whose name is empty.
    expect(extensionOf('.png')).toBeNull()
  })

  it('finds nothing when the dot is last', () => {
    expect(extensionOf('photo.')).toBeNull()
  })
})

describe('resolveUploadExtension', () => {
  it('accepts every allowed pairing', () => {
    expect(resolveUploadExtension('a.jpg', 'image/jpeg')).toEqual({ ok: true, extension: 'jpg' })
    expect(resolveUploadExtension('a.jpeg', 'image/jpeg')).toEqual({ ok: true, extension: 'jpeg' })
    expect(resolveUploadExtension('a.png', 'image/png')).toEqual({ ok: true, extension: 'png' })
    expect(resolveUploadExtension('a.webp', 'image/webp')).toEqual({ ok: true, extension: 'webp' })
  })

  it('accepts an uppercase extension and stores it lowercased', () => {
    expect(resolveUploadExtension('사진.JPEG', 'image/jpeg')).toEqual({
      ok: true,
      extension: 'jpeg',
    })
  })

  it('refuses a name with no extension', () => {
    expect(resolveUploadExtension('photo', 'image/png')).toEqual({
      ok: false,
      reason: '파일 이름에 확장자가 없습니다. (jpeg · jpg · png · webp)',
    })
  })

  it.each(['payload.exe', 'logo.svg', 'photo.gif', 'archive.zip'])(
    'refuses %s, whatever it claims to be',
    (filename) => {
      expect(refusalFor(resolveUploadExtension(filename, 'image/png'))).toContain(
        '지원하지 않는 확장자',
      )
    },
  )

  it('refuses an allowed extension that contradicts the declared type', () => {
    expect(resolveUploadExtension('photo.png', 'image/jpeg')).toEqual({
      ok: false,
      reason: '확장자 .png 와(과) 형식 image/jpeg 이(가) 일치하지 않습니다.',
    })
  })

  it('refuses a double extension whose last part is not an image', () => {
    // `photo.png.exe` is the classic one — the eye stops at `.png`.
    expect(refusalFor(resolveUploadExtension('photo.png.exe', 'image/png'))).toContain(
      '지원하지 않는 확장자',
    )
  })
})

describe('productImageKey', () => {
  it('puts the store id in the key', () => {
    expect(productImageKey(SELLER, OBJECT, 'png')).toBe(`products/${SELLER}/${OBJECT}.png`)
  })

  it.each([
    ['a store id that is not a UUID', 'store-1', OBJECT, 'png'],
    ['an object id that is not a UUID', SELLER, 'object', 'png'],
    ['an extension outside the whitelist', SELLER, OBJECT, 'exe'],
    ['a store id carrying a path segment', `${SELLER}/..`, OBJECT, 'png'],
  ])('refuses to build a key from %s', (_case, sellerId, objectId, extension) => {
    expect(() => productImageKey(sellerId, objectId, extension)).toThrow(/스토리지 키/)
  })
})
