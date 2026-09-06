'use client'

import type { ApiFailure, Claim } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ForceInput } from './claim-console'
import { forceRequestOf } from './claim-console'
import { dismissClaimAppeal, fetchClaim, forceClaim } from './console-api'

/**
 * 클레임 하나와, 관리자가 그것에 대해 할 수 있는 두 가지.
 *
 * **강제 처리의 답은 이 클레임이 아니다.** 서버는 방금 만들어진 **개입 클레임**을
 * 돌려주고 원본은 거절된 채 남는다. 그래서 성공 뒤에 하는 일이 두 가지다 — 부르는
 * 쪽에 개입의 id 를 넘겨 주고(문장과 링크가 그것을 쓴다), **원본을 다시 읽는다.**
 * 다시 읽는 이유는 그 한 번에 두 사실이 함께 도착하기 때문이다: `overturnedByClaimIds`
 * 에 개입이 붙고, 걸려 있던 이의가 인용으로 닫힌다.
 *
 * **이의 기각은 다시 읽지 않는다.** 답이 곧 갱신된 이 클레임이라 그대로 앉히면 되고,
 * 한 번 더 읽으면 방금 받은 것과 같은 값을 위해 왕복이 하나 더 는다.
 *
 * 쓰기가 던지지 않고 **결과 값**을 돌려주는 것은 부르는 쪽이 대화상자이기 때문이다 —
 * 실패해도 계속 그려야 하고, 실패의 종류에 따라 다른 자리에 다른 문장을 놓는다.
 */

export type AdminClaimState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly claim: Claim }

/**
 * 쓰기 하나의 결말.
 *
 * **`null` 이 세 번째 답이다** — 「아무것도 보내지 않았다」. 두 번 눌린 두 번째 클릭이
 * 그 자리이고, 그것을 실패로 돌려주면 화면은 방금 시작된 요청 위에 「요청을
 * 취소했어요」를 그린다. 아무 일도 없었으므로 화면도 아무것도 하지 않아야 한다.
 */
export type ClaimWriteResult =
  | { readonly ok: true; readonly claim: Claim }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface AdminClaimController {
  readonly state: AdminClaimState
  /** 쓰기가 도는 중. 두 번째 클릭이 두 번째 요청이 되지 않게 한다 (U3). */
  readonly busy: boolean
  readonly reload: () => void
  readonly force: (input: ForceInput) => Promise<ClaimWriteResult | null>
  readonly dismissAppeal: (reason: string) => Promise<ClaimWriteResult | null>
}

export function useAdminClaim(claimId: string): AdminClaimController {
  const [state, setState] = useState<AdminClaimState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * 도는 중인지를 **ref 로도** 든다.
   *
   * 두 번 눌린 두 번째 클릭은 리액트가 `busy: true` 로 다시 그리기 **전에** 도착한다.
   * 상태만으로 막으면 그 사이에 요청이 두 번 나가고, 강제 처리에서 그것은 개입
   * 클레임이 두 개 서는 일이다 (`form/use-submit.ts` 가 같은 이유로 같은 장치를 쓴다).
   */
  const inFlight = useRef(false)

  /**
   * 다시 읽되 **화면을 스켈레톤으로 되돌리지 않는다.**
   *
   * 강제 처리 뒤의 다시 읽기가 그 자리다 — 방금 무엇을 한 사람에게 화면이 통째로
   * 사라졌다 돌아오면, 그것은 자기 클릭이 화면을 지운 것처럼 보인다. ref 인 이유는 그
   * 값을 읽는 효과가 **이미** 그것 때문에 도는 중이라, 상태로 두면 요청이 시작되기도
   * 전에 렌더가 한 번 더 돌기 때문이다 (`use-seller-review.ts` 의 같은 장치).
   */
  const silent = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const answer = await fetchClaim(claimId, { signal: controller.signal })

        if (!controller.signal.aborted) setState({ status: 'ready', claim: answer.claim })
      } catch (error) {
        if (controller.signal.aborted) return

        const failure = apiFailure(error)

        // 없는 클레임은 오류가 아니라 **빈 상태**다. 「다시 시도」를 내밀면 몇 번을
        // 눌러도 같은 404 가 오고, 할 일은 목록으로 돌아가는 것이다.
        setState(
          failure.kind === 'http' && failure.status === 404
            ? { status: 'missing' }
            : { status: 'error', failure },
        )
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [claimId, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const refresh = useCallback(() => {
    silent.current = true
    setReloadToken((token) => token + 1)
  }, [])

  const run = useCallback(async (work: () => Promise<Claim>): Promise<ClaimWriteResult | null> => {
    // 이미 도는 중이면 **아무것도 보내지 않는다.** 실패가 아니라 무행동이다.
    if (inFlight.current) return null

    inFlight.current = true
    setBusy(true)

    try {
      return { ok: true, claim: await work() }
    } catch (error) {
      return { ok: false, failure: apiFailure(error) }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [])

  const force = useCallback(
    async (input: ForceInput): Promise<ClaimWriteResult | null> => {
      // 아직 읽지 못한 클레임에는 개입할 것이 없다. 버튼도 그때는 없다.
      if (state.status !== 'ready') return null

      const claim = state.claim
      const result = await run(async () => {
        const answer = await forceClaim(forceRequestOf(claim, input))

        return answer.claim
      })

      // 원본을 다시 읽는다 — 개입이 붙고 이의가 닫힌 모습이 그 한 번에 온다.
      if (result?.ok === true) refresh()

      return result
    },
    [state, run, refresh],
  )

  const dismiss = useCallback(
    async (reason: string): Promise<ClaimWriteResult | null> => {
      const result = await run(async () => {
        const answer = await dismissClaimAppeal(claimId, { reason })

        return answer.claim
      })

      // 답이 곧 갱신된 이 클레임이다. 다시 읽으면 같은 값을 위해 왕복이 하나 는다.
      if (result?.ok === true) setState({ status: 'ready', claim: result.claim })

      return result
    },
    [claimId, run],
  )

  return { busy, dismissAppeal: dismiss, force, reload, state }
}
