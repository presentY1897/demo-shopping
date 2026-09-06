'use client'

import type { ApiFailure } from '@shopping/shared'
import { RETURN_PHOTO_MAX_COUNT } from '@shopping/shared'
import { Button, ImageDropZone } from '@shopping/ui/components'

import { RETURN_PHOTO_ACCEPT } from '@/lib/claims/return-photos'
import type { ReturnPhoto, ReturnPhotos } from '@/lib/claims/use-return-photos'
import type { ReturnPhotoMessages } from '@/messages'

/**
 * 반품 사진을 붙이는 칸 — **두 화면이 같은 것을 그린다** (TASK-0071 F3 · F4).
 *
 * ## 왜 한 컴포넌트인가
 *
 * 서버가 두 경로에 같은 것을 요구하기 때문이다. 확정 후 하자 반품과 **거절을 뒤집는
 * 개입**은 실 서버에서 같은 문(`ClaimService.createWith`)을 지나고, 거기서
 * `returnPhotoDecision` 이 하자·오배송에 사진을 **필수**로 요구한다. 두 화면이 각자
 * 칸을 그리면 한쪽에만 있는 일이 생기고, 실제로 그랬다 — 뒤집기 다이얼로그에는 칸이
 * 없어서 하자로 뒤집는 모든 요청이 실 서버에서 400 으로 끝났다.
 *
 * ## 이 컴포넌트가 하지 **않는** 것
 *
 * 판정하지 않는다. 「사진이 필요한가」는 `forcePhotoRule` · `defectReturnIssues` 가
 * 답하고 부르는 쪽이 그 답으로 이 칸을 그릴지 정한다 — 단순 변심에는 칸 자체가
 * 없어야 하기 때문이다(있으면 붙일 수 있고, 붙이면 서버가 거절한다).
 *
 * 올리는 것도 하지 않는다. {@link ReturnPhotos} 를 받아 그리기만 한다 — 훅을 여기서
 * 부르면 붙인 사진이 이 칸의 것이 되어, 신청서를 조립하는 쪽이 열쇠를 얻을 방법이
 * 없어진다.
 */

export interface ReturnPhotoFieldProps {
  readonly photos: ReturnPhotos
  readonly messages: ReturnPhotoMessages
  /** 실패를 이 화면의 문장으로. presign 이 낸 오류만 이것을 지난다. */
  readonly describe: (failure: ApiFailure) => string
}

export function ReturnPhotoField({ photos, messages, describe }: ReturnPhotoFieldProps) {
  return (
    <section aria-label={messages.photosLabel} className="flex flex-col gap-2">
      <h3 className="text-fg text-sm font-medium">{messages.photosLabel}</h3>
      <ImageDropZone
        accept={RETURN_PHOTO_ACCEPT}
        description={messages.photosHint.replace('{max}', String(RETURN_PHOTO_MAX_COUNT))}
        dropLabel={messages.photosDropActive}
        label={messages.photosDropLabel}
        multiple
        onFiles={photos.add}
      />

      {photos.photos.length === 0 ? null : (
        <ul aria-label={messages.photosListLabel} className="flex flex-col gap-1">
          {photos.photos.map((photo) => (
            <li
              className="border-border flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
              key={photo.id}
            >
              <span className="text-fg min-w-0 flex-1 truncate">{photo.name}</span>
              <span className={photo.status === 'failed' ? 'text-danger' : 'text-fg-muted'}>
                {messages.photoStatus[photo.status]}
              </span>
              {photo.failure === null ? null : (
                <span className="text-danger basis-full text-xs">
                  {photoFailureSentence(photo, messages, describe)}
                </span>
              )}
              <Button
                onClick={() => {
                  photos.remove(photo.id)
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {messages.photoRemove.replace('{name}', photo.name)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * 사진 한 장이 왜 못 올라갔는가, 이 콘솔의 말로.
 *
 * 셋이 서로 다른 곳에서 온다 — 고르는 자리의 거절(`checkReturnPhoto`), presign 이
 * 답한 실패(우리 오류 봉투, 그래서 `describe` 를 지난다), 버킷의 거절. 마지막이 따로
 * 있는 이유는 저장소가 우리 API 가 아니라 **아무 설명도 오지 않기** 때문이다.
 */
function photoFailureSentence(
  photo: ReturnPhoto,
  messages: ReturnPhotoMessages,
  describe: (failure: ApiFailure) => string,
): string {
  const failure = photo.failure

  if (failure === null) return ''
  if (failure.kind === 'storage') return messages.photoFailures.storage
  if (failure.kind === 'api') return describe(failure.failure)

  return messages.photoFailures[failure.reason].replace('{max}', String(RETURN_PHOTO_MAX_COUNT))
}
