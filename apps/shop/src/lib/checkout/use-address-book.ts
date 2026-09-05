'use client'

import type { Address } from '@shopping/shared'
import { addressListResponseSchema } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { getApiClient } from '@/lib/api'

/**
 * 저장된 배송지 (TASK-0111 의 API 를 그대로 부른다).
 *
 * 주문서가 자기 배송지 표를 갖지 않는다 — 이미 있는 것을 읽고, **주문은 그 값을
 * 복사한다**(TASK-0049 4.6). 새로 넣는 일은 주소록 화면(TASK-0112)이 이미 하고
 * 있고, 그 화면으로 갔다가 돌아와도 주문서는 살아 있다: 주문서는 서버에 id 로
 * 있고 예약은 그대로 잡혀 있다.
 *
 * 실패는 **빈 목록**이다. 배송지를 못 읽었다고 주문서 전체를 오류 화면으로 바꾸면,
 * 사람이 할 수 있는 일이 아무것도 없어진다 — 빈 목록은 「새로 추가」라는 길을 남긴다.
 */
export interface AddressBook {
  readonly rows: readonly Address[]
  readonly loading: boolean
}

export function useAddressBook(): AddressBook {
  const [rows, setRows] = useState<readonly Address[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await getApiClient().request({
          path: '/me/addresses',
          schema: addressListResponseSchema,
          signal: controller.signal,
        })

        if (!controller.signal.aborted) setRows(answer.items)
      } catch {
        // 빈 목록으로 남는다.
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [])

  return { rows, loading }
}
