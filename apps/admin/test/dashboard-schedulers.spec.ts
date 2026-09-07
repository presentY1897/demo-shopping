/**
 * 배치 열 개에 이름과 무게를 붙이는 판단 (TASK-0092 F4).
 *
 * 이 모듈이 틀리면 **화면은 멀쩡히 그려진다.** 이름을 못 붙인 배치를 숨기면 멈춘
 * 배치가 화면에서 사라지고, `never` 를 `stale` 과 같은 색으로 칠하면 배포 직후마다
 * 빨간 화면이 뜬다 — 그것이 몇 번 반복되면 사람은 그 색을 안 믿는다. 그래서
 * `vitest.config.mjs` 가 이 모듈을 분기 100% 로 잡는다.
 */

import { describe, expect, it } from 'vitest'

import {
  isSchedulerKey,
  SCHEDULER_KEYS,
  SCHEDULER_VARIANTS,
  schedulerLabel,
  sortSchedulers,
  systemSummary,
} from '@/lib/dashboard/schedulers'
import { messagesFor } from '@/messages'

import { scheduler } from './support/dashboard'

const names = messagesFor().dashboard.system.names

describe('배치 이름', () => {
  /**
   * 열쇠 열 개 전부에 한국어 이름이 있다. `Record` 라 typecheck 이 먼저 잡지만,
   * 빈 문자열은 컴파일을 통과하고 화면에서만 사라진다.
   */
  it('names every scheduler the registry knows about', () => {
    for (const key of SCHEDULER_KEYS) {
      expect(names[key].length).toBeGreaterThan(0)
      expect(schedulerLabel(key, names)).toBe(names[key])
    }
  })

  /**
   * API 와 콘솔은 **따로 배포된다.** 새 배치를 실은 서버가 이 화면보다 먼저 뜨는
   * 순간이 실제로 있고, 그때 그 줄을 숨기면 멈춘 배치가 아무 데도 안 보이게 된다 —
   * 그것이 정확히 이 섹션이 막으려던 일이다. 못생긴 열쇠가 없는 것보다 낫다.
   */
  it('falls back to the raw key rather than hiding a scheduler it has no name for', () => {
    expect(isSchedulerKey('search.reindex.lastRunAt')).toBe(false)
    expect(schedulerLabel('search.reindex.lastRunAt', names)).toBe('search.reindex.lastRunAt')
  })
})

describe('상태의 무게', () => {
  /**
   * **`never` 는 붉지 않다.** 한 번도 안 돈 것은 갓 뜬 프로세스의 정상 상태이고,
   * 돌다가 멈춘 것은 사고다. 셋이 서로 다른 색인 것이 이 표의 요점이다.
   */
  it('paints a stopped scheduler differently from one that has never run', () => {
    expect(SCHEDULER_VARIANTS.stale).toBe('danger')
    expect(SCHEDULER_VARIANTS.never).not.toBe(SCHEDULER_VARIANTS.stale)
    expect(SCHEDULER_VARIANTS.ok).not.toBe(SCHEDULER_VARIANTS.stale)
  })
})

describe('표의 순서', () => {
  /**
   * 등록 순서대로 그리면 아홉 줄이 초록인 표의 여섯째 줄에 붉은 줄 하나가 끼고,
   * 그것은 스크롤해 내려가며 찾아야 하는 이상이다.
   */
  it('puts the stopped ones first, then the ones that have never run', () => {
    const rows = sortSchedulers([
      scheduler({ key: 'a', status: 'ok' }),
      scheduler({ key: 'b', lastRunAt: null, status: 'never' }),
      scheduler({ key: 'c', status: 'stale' }),
      scheduler({ key: 'd', status: 'ok' }),
    ])

    expect(rows.map((row) => row.key)).toEqual(['c', 'b', 'a', 'd'])
  })

  /** 같은 상태 안에서는 받은 순서를 지킨다 — 서버가 보내는 순서는 등록 순서다. */
  it('keeps the order the server sent within one status', () => {
    const rows = sortSchedulers([
      scheduler({ key: 'first', status: 'ok' }),
      scheduler({ key: 'second', status: 'ok' }),
    ])

    expect(rows.map((row) => row.key)).toEqual(['first', 'second'])
  })

  /** 원본을 뒤집지 않는다. 답을 상태로 들고 있는 화면에서 그것은 조용한 사고다. */
  it('does not sort the array it was handed', () => {
    const given = [
      scheduler({ key: 'ok', status: 'ok' }),
      scheduler({ key: 'bad', status: 'stale' }),
    ]

    sortSchedulers(given)

    expect(given.map((row) => row.key)).toEqual(['ok', 'bad'])
  })
})

describe('섹션 머리의 한 문장', () => {
  /** 사고가 있으면 그것만 말한다 — 「아직 안 돈 것도 둘 있어요」는 지금 할 말이 아니다. */
  it('reports the stopped ones before anything else', () => {
    expect(
      systemSummary([
        scheduler({ status: 'stale' }),
        scheduler({ key: 'b', lastRunAt: null, status: 'never' }),
        scheduler({ key: 'c', status: 'stale' }),
      ]),
    ).toEqual({ count: 2, kind: 'stopped' })
  })

  /** 방금 뜬 프로세스. 사고가 아니므로 문장도 다르다. */
  it('reports the ones that have never run as their own thing', () => {
    expect(
      systemSummary([
        scheduler({ status: 'ok' }),
        scheduler({ key: 'b', lastRunAt: null, status: 'never' }),
      ]),
    ).toEqual({ count: 1, kind: 'idle' })
  })

  it('says everything is running when it is', () => {
    expect(systemSummary([scheduler(), scheduler({ key: 'b' })])).toEqual({ kind: 'ok' })
  })
})
