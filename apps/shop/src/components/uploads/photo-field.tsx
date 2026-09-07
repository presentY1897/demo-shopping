'use client'

import { Button, ImageDropZone } from '@shopping/ui/components'
import { useId } from 'react'

import { PHOTO_UPLOAD_ACCEPT } from '@/lib/uploads/photo-uploads'
import type { PhotoUpload, PhotoUploads } from '@/lib/uploads/use-photo-uploads'
import type { PhotoUploadFailureKey, PhotoUploadMessages } from '@/messages'

/**
 * 사진을 붙이는 칸 — 반품 신청서와 리뷰 작성 폼이 **같은 것**을 쓴다.
 *
 * ## `ImageUploadList` 가 아닌 이유
 *
 * `packages/ui` 의 `ImageDropZone` 은 파일을 받는 일만 하므로 그대로 쓴다. 반면
 * 목록은 이쪽의 것이다. `ImageUploadList` 는 **순서가 모델**인 갤러리라 「대표」와
 * 앞뒤 이동을 갖는데, 증거 사진에도 리뷰 사진에도 대표는 없다 — 없는 뜻을 가진 버튼을
 * 세 개 그리는 것보다 「무엇이 붙었고 무엇이 실패했는가」만 말하는 편이 낫다.
 *
 * **미리보기를 그리지 않는 것도 결정이다.** 사람이 방금 고른 파일이고 무엇을
 * 골랐는지는 파일 이름이 말한다. 객체 URL 을 만들면 그것을 되돌려 주는 일
 * (`revokeObjectURL`)이 이 화면의 생애주기에 하나 더 붙는데, 그 값이 여기서는
 * 크지 않다.
 *
 * ## 상한은 훅이 들고 온다
 *
 * 반품은 `RETURN_PHOTO_MAX_COUNT`, 리뷰는 `REVIEW_IMAGE_MAX_COUNT` 이고 지금은 둘 다
 * 다섯이다. 이 컴포넌트가 그중 하나를 골라 적으면 다른 쪽이 바뀌는 날 **아무 검사도
 * 실패하지 않은 채** 틀린 숫자를 그린다.
 */
export function PhotoField({
  copy,
  invalid,
  issue,
  uploads,
}: {
  readonly copy: PhotoUploadMessages
  readonly invalid: boolean
  /** 지금 보일 문장. 없으면 빈 문자열이다 — 자리는 남는다 (U2). */
  readonly issue: string
  readonly uploads: PhotoUploads
}) {
  const hintId = useId()
  const issueId = useId()
  const full = uploads.photos.length >= uploads.maxCount

  return (
    <fieldset aria-describedby={`${hintId} ${issueId}`} className="flex flex-col gap-2">
      <legend className="text-fg text-sm font-medium">{copy.legend}</legend>

      <p className="text-fg-muted text-xs" id={hintId}>
        {copy.hint.replace('{max}', String(uploads.maxCount))}
      </p>

      {/*
        상한을 채우면 고르는 자리를 **비활성**으로 둔다. 감추면 왜 못 고르는지
        말할 자리가 사라지고, 한 장을 빼면 다시 나타나는 칸을 사람이 예측할 수 없다.
      */}
      <ImageDropZone
        accept={PHOTO_UPLOAD_ACCEPT}
        disabled={full}
        dropLabel={copy.droppingLabel}
        label={copy.dropLabel}
        multiple
        onFiles={(files) => {
          uploads.add(files)
        }}
      />

      {uploads.photos.length === 0 ? null : (
        <ul aria-label={copy.listLabel} className="flex flex-col gap-2">
          {uploads.photos.map((photo) => (
            <PhotoRow
              copy={copy}
              key={photo.id}
              maxCount={uploads.maxCount}
              onRemove={() => {
                uploads.remove(photo.id)
              }}
              photo={photo}
            />
          ))}
        </ul>
      )}

      <p className={invalid ? 'text-danger text-sm' : 'text-fg-muted text-sm'} id={issueId}>
        {issue}
      </p>
    </fieldset>
  )
}

/**
 * 한 장의 줄 — 이름, 지금 상태, 그리고 뺄 수 있는 버튼.
 *
 * **실패한 장도 목록에 남는다.** 조용히 사라지면 사람은 다섯 장을 골랐는데 네
 * 장만 붙은 이유를 알 수 없고, 그 넷 중 어느 것이 빠졌는지도 모른다.
 */
function PhotoRow({
  copy,
  maxCount,
  photo,
  onRemove,
}: {
  readonly copy: PhotoUploadMessages
  readonly maxCount: number
  readonly photo: PhotoUpload
  readonly onRemove: () => void
}) {
  return (
    <li className="border-border bg-surface flex items-center gap-3 rounded-md border px-3 py-2">
      <span className="text-fg min-w-0 flex-1 truncate text-sm">{photo.name}</span>

      {/*
        상태를 색이 아니라 **말**로 나른다 (WCAG 1.4.1).

        `role="status"` 를 **줄이 살아 있는 내내** 둔다. 올라가는 동안에만 두면 다
        올라간 순간에 살아 있는 영역 자체가 사라지므로 바뀐 문장이 읽히지 않고,
        그 순간이야말로 화면을 안 보는 사람이 기다리던 순간이다.
      */}
      <span
        className={photo.status === 'failed' ? 'text-danger text-xs' : 'text-fg-muted text-xs'}
        role="status"
      >
        {photo.failure === null
          ? copy.statuses[photo.status]
          : copy.failures[failureKeyOf(photo.failure)].replace('{max}', String(maxCount))}
      </span>

      <Button
        aria-label={copy.removeNamed.replace('{name}', photo.name)}
        onClick={onRemove}
        size="sm"
        type="button"
        variant="ghost"
      >
        {copy.remove}
      </Button>
    </li>
  )
}

/** 실패 다섯을 문장표의 열쇠로. 갈래가 늘면 `Record` 가 컴파일로 막는다. */
function failureKeyOf(failure: NonNullable<PhotoUpload['failure']>): PhotoUploadFailureKey {
  if (failure.kind === 'rejected') return failure.reason

  return failure.kind
}
