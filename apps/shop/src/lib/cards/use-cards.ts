'use client'

import type { ApiFailure } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import type { IssuedCard } from '@/lib/payment/payment-api'
import { fetchCards } from '@/lib/payment/payment-api'

import { activateCard, deleteCard, issueCard, suspendCard } from './cards-api'

/**
 * `/mypage/cards` 뒤의 지갑 (TASK-0058).
 *
 * **쓰기가 끝날 때마다 목록을 다시 읽는다.** 배송지에서와 이유가 다르다 — 거기서는
 * 요청이 이름 대지 않은 줄이 같이 바뀌기 때문이었고(기본 배송지가 옮겨 간다), 여기서는
 * **이 화면이 보여 주는 숫자를 이 화면이 바꾸지 않기** 때문이다.
 *
 * 사용액과 사용 가능액을 움직이는 것은 결제와 환불이고, 그것은 다른 탭에서·다른
 * 기기에서·이 화면이 열려 있는 동안 일어난다. 정지 응답이 돌려준 카드 한 장을 목록에
 * 끼워 넣으면 나머지 두 장은 화면을 연 순간의 숫자로 남고, 「환불이 잘 됐는지 잔액으로
 * 확인」하러 온 사람이 **낡은 잔액**을 본다. 쓰기가 끝난 순간은 그 숫자를 다시 읽기에
 * 가장 좋은 때다.
 *
 * 카드는 사람당 세 장까지라 목록은 언제나 작다. 왕복 하나를 더 쓰는 대신 화면에 있는
 * 모든 숫자가 서버의 것이 된다.
 */

export type CardListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly items: readonly IssuedCard[] }

export type CardMutationResult =
  { readonly ok: true } | { readonly ok: false; readonly failure: ApiFailure }

/**
 * 발급만 결과에 카드를 싣는다.
 *
 * 목록을 다시 읽어도 **어느 것이 방금 만든 카드인지**는 알 수 없다 — 세 장이 다
 * 「9999-****-****-」로 시작하고, 화면은 목록의 앞뒤 순서만 안다. 발급 응답이 그
 * 카드를 들고 오므로 그것을 그대로 넘긴다. 정지·해제·삭제에는 이 문제가 없다:
 * 부르는 쪽이 이미 어느 카드인지 알고 부른다.
 */
export type CardIssueResult =
  | { readonly ok: true; readonly card: IssuedCard }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface CardWalletConsole {
  readonly state: CardListState
  readonly reload: () => void
  readonly issue: (creditLimit: number) => Promise<CardIssueResult>
  readonly suspend: (id: string) => Promise<CardMutationResult>
  readonly activate: (id: string) => Promise<CardMutationResult>
  readonly remove: (id: string) => Promise<CardMutationResult>
}

export function useCardWallet(): CardWalletConsole {
  const [state, setState] = useState<CardListState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await fetchCards({ signal: controller.signal })
        if (controller.signal.aborted) return

        setState({ status: 'ready', items: answer.cards })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  /**
   * 쓰기 뒤의 다시 읽기. 실패해도 조용하다.
   *
   * 다시 읽기가 실패한 것 자체는 사람에게 할 말이 아니다 — 정지는 됐고, 화면에 남은
   * 숫자가 한 박자 낡았을 뿐이다. 여기서 오류 화면을 띄우면 성공한 쓰기가 실패로
   * 보인다.
   */
  const refetch = useCallback(async (): Promise<void> => {
    try {
      const answer = await fetchCards()

      setState({ status: 'ready', items: answer.cards })
    } catch {
      // 앞 문단.
    }
  }, [])

  /** 카드를 가리키는 쓰기 하나. 셋이 같은 모양이라 갈래를 여기 한 번만 적는다. */
  const write = useCallback(
    async (call: () => Promise<unknown>): Promise<CardMutationResult> => {
      try {
        await call()
        await refetch()

        return { ok: true }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [refetch],
  )

  const issue = useCallback(
    async (creditLimit: number): Promise<CardIssueResult> => {
      try {
        const card = await issueCard(creditLimit)
        await refetch()

        return { ok: true, card }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [refetch],
  )

  const suspend = useCallback((id: string) => write(() => suspendCard(id)), [write])
  const activate = useCallback((id: string) => write(() => activateCard(id)), [write])
  const remove = useCallback((id: string) => write(() => deleteCard(id)), [write])

  return { activate, issue, reload, remove, state, suspend }
}
