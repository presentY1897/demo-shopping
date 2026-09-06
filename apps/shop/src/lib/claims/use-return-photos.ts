'use client'

import type { ApiFailure } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getApiClient } from '@/lib/api'

import type { ReturnPhotoRejection } from './return-photos'
import { checkReturnPhoto } from './return-photos'

/**
 * 반품 사진을 버킷에 올리고, 그 **열쇠**를 신청서에 넘긴다 (TASK-0067 F2).
 *
 * ## 두 걸음이고, 둘째는 우리 API 가 아니다
 *
 * `POST /uploads/presign` 으로 서명된 URL 을 받고, 그 URL 로 파일을 **직접** PUT
 * 한다. 바이트가 API 를 지나지 않는 것이 배포의 요구다(`uploads.ts` 계약) — 512MB
 * 인스턴스에 5MB 업로드 몇 개가 동시에 들어오면 그것으로 끝이다.
 *
 * 그래서 실패도 두 종류다. 앞의 것은 우리 오류 봉투를 갖고(`ApiFailure`), 뒤의 것은
 * **아무 봉투도 없다** — 저장소는 우리 API 가 아니므로 403 하나가 전부다. 그 둘을
 * 한 값으로 뭉치면 화면은 「다시 시도해 주세요」 말고 할 말이 없어진다.
 *
 * ## 화면에 넘기는 것은 열쇠뿐이다
 *
 * URL 이 아니라 열쇠를 신청서에 싣는 이유는 계약에 적혀 있고(`returnPhotoKeyPattern`),
 * 여기서 중요한 것은 **열쇠를 우리가 짓지 않는다**는 점이다. 서버가 부르는 사람의
 * id 로 만들어 돌려주고, 그래서 「남의 사진을 내 신청서에 붙이는」 요청은 만들려야
 * 만들 수 없다.
 *
 * ## 지운다는 것은 목록에서 뺀다는 뜻이다
 *
 * 이미 올라간 객체는 지우지 않는다. 지우는 라우트가 없고(`ObjectStorage` 는
 * `presign` 과 `publicUrl` 뿐이다), 신청서에 실리지 않은 열쇠는 어느 반품에도
 * 매달리지 않는다 — 판매자 이미지 위젯이 같은 이유로 같은 선택을 했다 (TASK-0033 4.8).
 */

/** 사진 한 장이 지금 어디까지 왔는가. */
export type ReturnPhotoStatus = 'uploading' | 'ready' | 'failed'

/**
 * 왜 실패했는가.
 *
 * 셋으로 나누는 기준은 **사람이 할 일이 다른가**다 — 고른 파일이 문제면 다른 파일을
 * 골라야 하고, presign 이 거절됐으면 그 문장이 이유를 말하며, 버킷이 거절한 것은
 * 아무 설명도 오지 않으므로 다시 시도하는 수밖에 없다.
 */
export type ReturnPhotoFailure =
  | { readonly kind: 'rejected'; readonly reason: ReturnPhotoRejection }
  | { readonly kind: 'api'; readonly failure: ApiFailure }
  | { readonly kind: 'storage' }

export interface ReturnPhoto {
  /** 목록의 키. 파일 이름은 겹칠 수 있으므로 이름을 쓰지 않는다. */
  readonly id: string
  /** 고른 사람의 파일 이름. 실패했을 때 **어느 장인지** 짚으려고 있다. */
  readonly name: string
  readonly status: ReturnPhotoStatus
  /** 올라간 객체의 열쇠. 아직·영영 못 올라간 장은 `null` 이다. */
  readonly key: string | null
  readonly failure: ReturnPhotoFailure | null
}

export interface ReturnPhotos {
  readonly photos: readonly ReturnPhoto[]
  /** 신청서에 실을 것 — **올라간 것만**, 고른 순서 그대로. */
  readonly keys: readonly string[]
  /** 아직 올라가는 중인 장이 있는가. 보내기를 막는 값이다 (U3). */
  readonly uploading: boolean
  readonly add: (files: readonly File[]) => void
  readonly remove: (id: string) => void
  /** 사유가 바뀌어 사진 칸 자체가 사라졌을 때. 붙인 것을 통째로 버린다. */
  readonly clear: () => void
}

export function useReturnPhotos(): ReturnPhotos {
  const [photos, setPhotos] = useState<readonly ReturnPhoto[]>([])
  /**
   * 화면을 떠난 뒤에는 상태를 건드리지 않는다.
   *
   * 업로드는 사람이 뒤로 가거나 신청을 마친 뒤에도 끝날 수 있고, 그때의
   * `setState` 는 React 가 경고로만 알려 주는 종류의 누수다.
   */
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true

    return () => {
      alive.current = false
    }
  }, [])

  const patch = useCallback((id: string, next: Partial<ReturnPhoto>): void => {
    if (!alive.current) return

    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...next } : photo)),
    )
  }, [])

  const add = useCallback(
    (files: readonly File[]): void => {
      // **고른 순서대로 한 장씩 판정한다.** 상한을 넘는지는 앞서 붙인 장까지 세어야
      // 답이 나오므로, 전체를 한 번에 거르면 여섯 번째 장만 거절해야 할 때 다섯
      // 장 전부가 거절된다.
      setPhotos((current) => {
        const next = [...current]

        for (const file of files) {
          const id = photoId()
          const check = checkReturnPhoto(file, next.length)

          if (!check.ok) {
            next.push({
              id,
              name: file.name,
              status: 'failed',
              key: null,
              failure: { kind: 'rejected', reason: check.reason },
            })
            continue
          }

          next.push({ id, name: file.name, status: 'uploading', key: null, failure: null })
          void upload(file, check.contentType, id, patch)
        }

        return next
      })
    },
    [patch],
  )

  const remove = useCallback((id: string): void => {
    setPhotos((current) => current.filter((photo) => photo.id !== id))
  }, [])

  const clear = useCallback((): void => {
    setPhotos([])
  }, [])

  return {
    photos,
    keys: photos.flatMap((photo) => (photo.key === null ? [] : [photo.key])),
    uploading: photos.some((photo) => photo.status === 'uploading'),
    add,
    remove,
    clear,
  }
}

/**
 * 서명을 받고, 그 URL 에 그대로 PUT 한다.
 *
 * **헤더를 되돌려 보내는 것이 규약이다.** `Content-Type` 은 서명에 들어가 있어서
 * 다른 값을 보내면 저장소가 403 으로 거절한다 — 그래서 응답이 준 `headers` 를
 * 손대지 않고 그대로 싣는다. `Content-Length` 는 브라우저가 본문에서 채우며
 * 스크립트가 정할 수 없다.
 *
 * **본문은 파일이 아니라 그 바이트다.** 서명이 길이까지 포함하므로 보낸 길이가
 * 선언한 길이와 한 바이트라도 다르면 저장소가 403 으로 끝내는데, 파일 객체를 그대로
 * 넘기면 그 길이를 정하는 것이 우리가 아니라 실행 환경이 된다. 상한이 5MB 라
 * (`UPLOAD_MAX_BYTES`) 한 번에 읽어도 잃을 것이 없고, 그 대신 **선언한 길이와 보낸
 * 길이가 같은 값에서 나온다.**
 */
async function upload(
  file: File,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  id: string,
  patch: (id: string, next: Partial<ReturnPhoto>) => void,
): Promise<void> {
  try {
    const { upload: target } = await getApiClient().presignUpload({
      purpose: 'return-photo',
      filename: file.name,
      contentType,
      size: file.size,
    })
    const response = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: target.headers,
      body: await file.arrayBuffer(),
    })

    if (!response.ok) {
      patch(id, { status: 'failed', failure: { kind: 'storage' } })

      return
    }

    patch(id, { status: 'ready', key: target.key, failure: null })
  } catch (error) {
    patch(id, { status: 'failed', failure: { kind: 'api', failure: apiFailure(error) } })
  }
}

/** 목록 안에서만 뜻이 있는 id. 서버에 나가지 않으므로 형식이 없다. */
function photoId(): string {
  return `photo-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}
