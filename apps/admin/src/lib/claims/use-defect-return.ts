'use client'

import type {
  ApiFailure,
  Claim,
  ClaimableResponse,
  CreateAdminClaimRequest,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useRef, useState } from 'react'

import { fetchClaimable, forceClaim } from './console-api'

/**
 * 확정 후 하자 반품의 두 걸음 — **몫을 찾고, 대신 신청한다** (TASK-0071 F4).
 *
 * `use-admin-claim.ts` 와 나란히 있고 다른 것은 **시작점**이다. 저쪽은 클레임 하나를
 * 열쇠로 들고 시작하지만 여기는 아직 클레임이 없다 — 사람이 식별자를 적어 넣기
 * 전까지는 부를 것이 없고, 그래서 첫 상태가 `loading` 이 아니라 `idle` 이다.
 *
 * **읽기가 효과가 아니라 함수인 이유**도 그것이다. 효과로 두면 「무엇을 읽을지」를
 * 상태에 먼저 앉혀야 하고, 그러면 같은 식별자를 다시 조회하는 일이 상태를 흔들어야만
 * 가능해진다. 사람이 버튼을 누르는 순간이 곧 요청의 순간인 화면이므로 그 둘을 같은
 * 자리에 둔다.
 *
 * 쓰기가 던지지 않고 **결과 값**을 돌려주는 것은 부르는 쪽이 폼이기 때문이다 —
 * 실패해도 계속 그려야 하고, 실패의 종류에 따라 다른 자리에 다른 문장을 놓는다
 * (`use-admin-claim.ts` 의 `ClaimWriteResult` 와 같은 규약).
 */

export type DefectReturnLookup =
  /** 아직 아무것도 찾지 않았다. */
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  /** 그런 몫이 없다. 오류가 아니라 **빈 상태**다 — 다시 눌러도 같은 404 가 온다 */
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly claimable: ClaimableResponse }

export type DefectReturnResult =
  | { readonly ok: true; readonly claim: Claim }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface DefectReturnController {
  readonly lookup: DefectReturnLookup
  /** 쓰기가 도는 중. 두 번째 클릭이 두 번째 요청이 되지 않게 한다 (U3). */
  readonly busy: boolean
  readonly find: (sellerOrderId: string) => Promise<void>
  /** 찾아 둔 것을 버린다. 신청을 마치고 처음으로 돌아갈 때. */
  readonly reset: () => void
  readonly file: (request: CreateAdminClaimRequest) => Promise<DefectReturnResult | null>
}

export function useDefectReturn(): DefectReturnController {
  const [lookup, setLookup] = useState<DefectReturnLookup>({ status: 'idle' })
  const [busy, setBusy] = useState(false)

  /**
   * 도는 중인지를 **ref 로도** 든다.
   *
   * 두 번 눌린 두 번째 클릭은 리액트가 `busy: true` 로 다시 그리기 **전에** 도착한다.
   * 상태만으로 막으면 그 사이에 요청이 두 번 나가고, 여기서 그것은 **같은 주문에 반품
   * 클레임이 둘** 서는 일이다 — 두 번째는 남은 수량을 한 번 더 잡는다.
   */
  const inFlight = useRef(false)

  /** 조회도 같은 장치를 쓴다. 느린 응답 위에 두 번째 조회가 겹치면 답이 뒤바뀐다. */
  const finding = useRef(false)

  const find = useCallback(async (sellerOrderId: string): Promise<void> => {
    if (finding.current) return

    finding.current = true
    setLookup({ status: 'loading' })

    try {
      const claimable = await fetchClaimable(sellerOrderId)

      setLookup({ status: 'ready', claimable })
    } catch (error) {
      const failure = apiFailure(error)

      setLookup(
        failure.kind === 'http' && failure.status === 404
          ? { status: 'missing' }
          : { status: 'error', failure },
      )
    } finally {
      finding.current = false
    }
  }, [])

  const reset = useCallback((): void => {
    setLookup({ status: 'idle' })
  }, [])

  const file = useCallback(
    async (request: CreateAdminClaimRequest): Promise<DefectReturnResult | null> => {
      // 이미 도는 중이면 **아무것도 보내지 않는다.** 실패가 아니라 무행동이다.
      if (inFlight.current) return null

      inFlight.current = true
      setBusy(true)

      try {
        const answer = await forceClaim(request)

        return { ok: true, claim: answer.claim }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [],
  )

  return { busy, file, find, lookup, reset }
}
