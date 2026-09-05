import { randomUUID } from 'node:crypto'

import { APP_ID_HEADER, demoIssueResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { VIRTUAL_CARDS_PER_USER } from '../../src/payment/virtual-card-rules.js'
import type { IssuedCard } from '../../src/payment/virtual-card.service.js'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import { useApiApp } from '../support/api-app.js'
import { DEFAULT_TEST_INSTANT } from '../support/clock.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'

/**
 * 가상 카드와 그 원장 (TASK-0053), 이 워커의 실제 데이터베이스에 대해.
 *
 * **여기서 틀리면 카드가 감당하지 못하는 돈이 나간다.** 한도 판단이 한 칸
 * 어긋나거나 취소가 돌려주는 금액을 잘못 세면, 100만원짜리 카드가 100만원보다
 * 많이 쓴다 — 그리고 그 사실은 어느 화면에서도 빨갛게 나타나지 않는다. 대사를
 * 돌려야 보이고, 대사는 돈이 이미 움직인 뒤에 돈다.
 *
 * 그래서 아래의 단언은 「거절됐다」에서 멈추지 않는다. 거의 매번 **원장의 합과
 * `usedAmount` 가 여전히 같은지**까지 본다 ({@link expectSound}) — 거절해 놓고
 * 사용액만 올려 버리는 구현은 「거절됐다」만 보는 검사를 전부 통과하고, 그 카드는
 * 그 뒤로 영영 한도가 모자란다.
 *
 * 서비스를 앱에서 꺼내 쓴다. 카드에는 아직 자기 엔드포인트가 없고(결제 승인은
 * TASK-0054, 관리 화면은 TASK-0058) 시험 대상은 **서비스와 데이터베이스**다
 * (QUALITY-GATES Q5). 예외는 F5 하나다 — 「구매자 데모에 카드가 한 장 있다」는
 * 데모 발급 경로의 성질이지 이 서비스의 성질이 아니라, 실제 HTTP 로 발급해서
 * 잰다.
 */

const db = useDatabase()
const api = useApiApp({ database: db })

/** F1 이 재는 그 카드의 한도. 100만원. */
const LIMIT = 1_000_000

function cards(): VirtualCardService {
  return api.resolve<VirtualCardService>(VirtualCardService)
}

/** 이 사람으로 부르는 principal. 서비스는 헤더가 아니라 이것을 받는다. */
function principalOf(userId: string): RequestPrincipal {
  return { app: 'shop', userId, roles: ['BUYER'], sellerId: null }
}

let buyer: RequestPrincipal

beforeEach(async () => {
  buyer = principalOf((await createUser(db)).id)
})

/** 또 한 명의 구매자. 남의 카드를 시험할 때 쓴다. */
async function stranger(): Promise<RequestPrincipal> {
  return principalOf((await createUser(db)).id)
}

/** 한도 `limit` 짜리 카드 한 장. */
function issue(limit: number = LIMIT, owner: RequestPrincipal = buyer): Promise<IssuedCard> {
  return cards().issue(owner, limit)
}

/** 서비스가 던진 거부의 상태와 도메인 코드. */
interface Refusal {
  readonly status: number
  readonly code: string
}

function refusalOf(error: unknown): Refusal {
  if (error === null || typeof error !== 'object' || !('getStatus' in error)) {
    throw new Error(`거부를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const exception = error as { getStatus: () => number; getResponse: () => unknown }
  const payload = exception.getResponse()
  const code =
    typeof payload === 'object' && payload !== null && 'code' in payload ? String(payload.code) : ''

  return { status: exception.getStatus(), code }
}

async function refusal(work: Promise<unknown>): Promise<Refusal> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  return refusalOf(error)
}

interface CardRow {
  readonly number: string
  readonly creditLimit: number
  readonly usedAmount: number
  readonly status: string
}

/** 표에서 바로 읽은 카드. 서비스가 돌려주는 것과 어긋나면 그것이 결함이다. */
function cardRow(cardId: string): Promise<CardRow> {
  return db.one<CardRow>(
    `SELECT "number", "creditLimit", "usedAmount", "status"::text AS "status"
       FROM "VirtualCard" WHERE "id" = $1`,
    [cardId],
  )
}

interface LedgerRow {
  readonly kind: string
  readonly amount: number
  readonly balanceAfter: number
  readonly refId: string
}

function ledgerOf(cardId: string): Promise<LedgerRow[]> {
  return db.query<LedgerRow>(
    `SELECT "kind"::text AS "kind", "amount", "balanceAfter", "refId"
       FROM "VirtualCardTransaction" WHERE "cardId" = $1 ORDER BY "createdAt", "id"`,
    [cardId],
  )
}

/**
 * 원장을 **참조로** 집는다. 순서로 집지 않는 이유가 있다.
 *
 * `VirtualCardTransaction` 에는 재고 원장의 `seq` 같은 자리 번호가 없고
 * `createdAt` 은 밀리초까지다 — 연달아 지나간 두 사건이 같은 값을 받을 수 있고,
 * 그때의 행 순서는 Postgres 가 정한다. 참조 하나에 사건 하나를 대응시키면 그
 * 애매함이 사라지고, 단언이 재는 것도 더 정확해진다: **그 사건 직후의 잔액이
 * 얼마였나**이지 몇 번째 행이었나가 아니다.
 */
async function entriesByRef(cardId: string): Promise<Map<string, LedgerRow>> {
  const rows = await ledgerOf(cardId)

  return new Map(rows.map((row) => [row.refId, row]))
}

/** 이 카드가 여전히 성립하는가 — 합계, 상한, 그리고 잔액의 부호. */
function invariantsOf(cardId: string): Promise<{
  usedAmount: number
  ledgerBalance: number
  withinLimit: boolean
  negativeBalances: number
}> {
  return db.one(
    `SELECT c."usedAmount",
            COALESCE(l."sum", 0)::int                         AS "ledgerBalance",
            (c."usedAmount" BETWEEN 0 AND c."creditLimit")    AS "withinLimit",
            COALESCE(l."negative", 0)::int                    AS "negativeBalances"
       FROM "VirtualCard" c
       LEFT JOIN LATERAL (
         SELECT sum(t."amount")::int AS "sum",
                count(*) FILTER (WHERE t."balanceAfter" < 0)::int AS "negative"
           FROM "VirtualCardTransaction" t WHERE t."cardId" = c."id"
       ) l ON TRUE
      WHERE c."id" = $1`,
    [cardId],
  )
}

/**
 * 개별 단언이 무엇을 보든 **끝에는 이것이 참이어야 한다.**
 *
 * 원장의 합이 사용액이고(F3), 사용액은 0과 한도 사이이며, 어느 시점의 잔액도
 * 음수가 아니다. 그리고 대사는 아무것도 찾지 못한다 — 이 파일의 모든 쓰기가
 * 서비스를 지났으므로, 여기서 무언가 나온다면 그것은 서비스가 원장을 남기지
 * 않고 사용액을 옮겼다는 뜻이다.
 */
async function expectSound(cardId: string, usedAmount: number): Promise<void> {
  expect(await invariantsOf(cardId)).toEqual({
    usedAmount,
    ledgerBalance: usedAmount,
    withinLimit: true,
    negativeBalances: 0,
  })
  expect(await cards().reconcile()).toEqual([])
}

/**
 * 목록이 최신순인가.
 *
 * 「먼저 만든 것이 뒤에 온다」로 적지 않는 이유는 시계에 있다. 시험용 시계는
 * 고정이라(`clock-injection.spec.ts`) 한 검사가 만든 카드는 `createdAt` 이 전부
 * 같고, 그 값으로는 순서를 말할 수 없다. `VirtualCard.id` 는 uuid(7) 이라 만든
 * 시간 순으로 정렬되므로, **최신순은 id 의 내림차순**이다 — 그리고 이것은 어느
 * 카드가 더 큰 id 를 받았든 성립하는 성질이다.
 */
function isNewestFirst(listed: readonly IssuedCard[]): boolean {
  const ids = listed.map((card) => card.id)

  return ids.every((id, index) => index === 0 || (ids[index - 1] ?? '') > id)
}

/**
 * `parties` 개의 트랜잭션이 **이 카드의 잠금을 실제로 기다릴 때까지** 붙잡는다.
 *
 * `concurrently.ts` 의 `awaitBlocked` 와 같은 장치이고 같은 이유다. 장벽만으로는
 * 셋이 같은 순간에 **출발했다**는 것밖에 못 정한다 — 쓰기 구간이 차례로 지나가면
 * 「한도를 넘지 않았다」는 「읽고 나서 쓰는」 깨진 구현에서도 똑같이 초록이고, 그
 * 초록은 눈에 띄지 않는다.
 *
 * 이 데이터베이스는 이 워커 전용이고 파일 안의 검사는 차례로 도니, 잠금을
 * 기다리는 백엔드는 이 검사가 띄운 것들뿐이다.
 *
 * 기다리다 못 보면 **던진다.** 겹치지 않았다면 이 검사는 아무것도 재지 않았고,
 * 그 사실이 초록으로 지나가는 것보다는 빨간 것이 낫다.
 */
async function untilBackendsWait(parties: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const row = await db.one<{ waiting: number }>(
      `SELECT count(*)::int AS "waiting" FROM pg_stat_activity
        WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`,
    )

    if (row.waiting >= parties) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error(
    `승인 ${String(parties)}건이 같은 카드의 잠금을 기다리지 않았습니다 — 호출이 겹치지 않았습니다.`,
  )
}

/**
 * `parties` 개의 호출을 **정말로 겹쳐서** 실행한다.
 *
 * 배열은 두 겹이다. 검사가 자기 연결로 카드 행을 잠근 채 참가자들을 출발시키고,
 * 데이터베이스가 「셋 다 그 행을 기다리고 있다」고 말해 준 뒤에야 잠금을 놓는다.
 * 그 순간 셋은 전부 자기 트랜잭션 안에서, 같은 행 앞에 서 있다.
 *
 * 이 배열은 payments 의 F6 보다 한 칸 더 조인다. 저기는 「누군가 하나가 기다린다」
 * 였고 여기는 「참가자 전원이 기다린다」다. 그리고 잠금을 기다리는 참가자가 하나도
 * 없는 구현 — 잠금 없이 읽고 쓰는 구현 — 은 이 함수 안에서 **빨개진다.**
 *
 * 셋인 이유는 시험용 앱의 풀이 5이기 때문이다 (`test/support/app-config.ts`).
 * 검사가 쓰는 연결은 앱의 풀이 아니라 이 파일의 `pg` 풀에서 나온다.
 */
function underContention<T>(
  cardId: string,
  parties: number,
  task: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  return db.withConnection(async (holder) => {
    await holder.query('BEGIN')
    await holder.query('SELECT "id" FROM "VirtualCard" WHERE "id" = $1 FOR UPDATE', [cardId])

    const gate = barrier(parties)
    const running = concurrently(parties, async (index) => {
      await gate.arrive()

      return task(index)
    })

    let missed: Error | null = null

    try {
      await untilBackendsWait(parties)
    } catch (error: unknown) {
      missed = error instanceof Error ? error : new Error(String(error))
    } finally {
      // 무슨 일이 있어도 놓는다. 잠긴 채로 나가면 참가자들이 영영 안 끝나고,
      // 실패는 「겹치지 않았다」가 아니라 시간 초과로 보고된다.
      await holder.query('ROLLBACK')
    }

    const results = await running

    if (missed !== null) throw missed

    return results
  })
}

describe('발급 (F1)', () => {
  it('issues a card whose whole limit is available', async () => {
    const card = await issue(LIMIT)

    expect(card).toMatchObject({ creditLimit: LIMIT, usedAmount: 0, status: 'ACTIVE' })
    // 사용 가능액 = 한도 − 사용액 (4장). 발급 직후에는 한도 전부다.
    expect(card.creditLimit - card.usedAmount).toBe(LIMIT)
    expect(card.brand).not.toBe('')
    // 유효기간은 앞으로다. 지난 날짜로 발급된 카드는 한 번도 쓰이지 못하고,
    // 그 사실은 결제하려는 순간에야 드러난다.
    expect(Date.parse(card.expiresAt)).toBeGreaterThan(Date.parse(DEFAULT_TEST_INSTANT))

    expect(await cardRow(card.id)).toMatchObject({
      creditLimit: LIMIT,
      usedAmount: 0,
      status: 'ACTIVE',
    })
    // 아직 아무 일도 없었으므로 원장은 비어 있다. 발급 자체는 사건이 아니다.
    expect(await ledgerOf(card.id)).toEqual([])
    await expectSound(card.id, 0)
  })

  it('refuses a card with no limit to spend', async () => {
    // 한도 0짜리 카드는 카드가 아니고, 음수 한도는 표가 받지도 않는다
    // (`VirtualCard_creditLimit_check`). 서비스가 먼저 거절하지 않으면 이
    // 요청은 400 이 아니라 500 으로 끝난다 — 부르는 쪽이 무엇을 고쳐야 하는지
    // 알 수 없는 응답이다.
    expect((await refusal(cards().issue(buyer, 0))).status).toBe(400)
    expect((await refusal(cards().issue(buyer, -100_000))).status).toBe(400)
    expect(await db.query('SELECT 1 FROM "VirtualCard"')).toEqual([])
  })
})

describe('카드번호 (F7 · R1)', () => {
  it('gives the number a prefix no real card can have', async () => {
    const card = await issue()

    const { number } = await cardRow(card.id)

    // 접두어 `9999` 는 어떤 발급사에도 배정되지 않는다. 3·4·5·6 으로 시작하는
    // 실제 BIN 과 겹치면 화면의 「가상 카드」 문구보다 번호가 먼저 읽히고,
    // 방문자는 진짜 카드가 발급된 줄 안다 (R1).
    expect(number).toMatch(/^9999-\d{4}-\d{4}-\d{4}$/)
    expect(['3', '4', '5', '6']).not.toContain(number.slice(0, 1))
  })

  it('shows the number masked, and never the whole of it', async () => {
    const card = await issue()

    const { number } = await cardRow(card.id)

    // 저장은 전문, 노출은 마스킹이다 (TASK-0013 연동). 저장을 마스킹해 버리면
    // 뒤 네 자리가 같은 두 장을 구분할 방법이 사라지고, 전문을 그대로 내보내면
    // 로그와 화면에 카드번호가 남는다.
    expect(card.maskedNumber).toMatch(/^9999-\*{4}-\*{4}-\d{4}$/)
    expect(card.maskedNumber.slice(-4)).toBe(number.slice(-4))
    expect(card.maskedNumber.replace(/[^*]/g, '')).toHaveLength(8)
    expect(card.maskedNumber).not.toBe(number)
  })

  it('never issues the same number twice', async () => {
    const first = await issue()
    const second = await issue()

    const rows = await db.query<{ number: string }>(
      'SELECT "number" FROM "VirtualCard" WHERE "id" = ANY($1::uuid[])',
      [[first.id, second.id]],
    )

    // 난수로 만들지만 충돌이 0은 아니다 — 유니크 인덱스가 있고, 발급기는 그
    // 거절을 스스로 넘어서야 한다. 두 장이 같은 번호로 나오면 원장의 어느
    // 행이 어느 카드의 것인지 사람이 구별할 수 없게 된다.
    expect(new Set(rows.map((row) => row.number)).size).toBe(2)
  })
})

describe('목록', () => {
  it('lists this person’s cards, newest first', async () => {
    const first = await issue()
    const second = await issue()

    const listed = await cards().list(buyer)

    expect([...listed].map((card) => card.id).sort()).toEqual([first.id, second.id].sort())
    // 오래된 것부터 보여 주면 방금 만든 카드가 목록 바닥에 묻힌다.
    expect(isNewestFirst(listed)).toBe(true)
  })

  it('leaves out what this person deleted, and keeps its history', async () => {
    const kept = await issue()
    const removed = await issue()

    await cards().charge(removed.id, 10_000, randomUUID())
    await cards().remove(buyer, removed.id)

    expect([...(await cards().list(buyer))].map((card) => card.id)).toEqual([kept.id])
    // 소프트 삭제다. 원장이 이 카드를 가리키므로 행을 지우면 「환불이 제대로
    // 됐는지」를 나중에 확인할 방법이 함께 사라진다.
    expect((await cardRow(removed.id)).status).toBe('DELETED')
    expect(await ledgerOf(removed.id)).toHaveLength(1)
  })

  it('never shows somebody else’s card', async () => {
    const other = await stranger()
    const mine = await issue()
    const theirs = await issue(LIMIT, other)

    // 남의 카드가 목록에 섞이면 마스킹된 번호와 한도·사용액이 통째로 새어 나간다.
    expect([...(await cards().list(buyer))].map((card) => card.id)).toEqual([mine.id])
    expect([...(await cards().list(other))].map((card) => card.id)).toEqual([theirs.id])
  })
})

describe('원장 (F2)', () => {
  it('records an approval, a cancellation and a refund as three rows', async () => {
    const card = await issue(LIMIT)
    const approval = randomUUID()
    const cancellation = randomUUID()
    const refund = randomUUID()

    const charged = await cards().charge(card.id, 300_000, approval)
    const canceled = await cards().release(card.id, 100_000, cancellation, 'CANCEL')
    const refunded = await cards().release(card.id, 50_000, refund, 'REFUND')

    // 서비스가 매번 돌려주는 사용액이 화면에 그대로 뜬다. 여기가 어긋나면
    // 「환불이 됐는지 카드 잔액으로 눈으로 확인한다」는 이 TASK 의 목적이 깨진다.
    expect(charged.usedAmount).toBe(300_000)
    expect(canceled.usedAmount).toBe(200_000)
    expect(refunded.usedAmount).toBe(150_000)

    const entries = await entriesByRef(card.id)

    expect(entries.size).toBe(3)
    // 부호는 종류가 정하고, `balanceAfter` 는 **그 사건 직후의 사용액**이다.
    // 합계만 맞고 각 행의 잔액이 틀린 원장은 「그때 얼마였나」에 답하지 못하고,
    // 대사가 어디서 깨졌는지도 알려 주지 못한다.
    expect(entries.get(approval)).toMatchObject({
      kind: 'CHARGE',
      amount: 300_000,
      balanceAfter: 300_000,
    })
    expect(entries.get(cancellation)).toMatchObject({
      kind: 'CANCEL',
      amount: -100_000,
      balanceAfter: 200_000,
    })
    // 취소와 환불은 같은 방향이지만 같은 사건이 아니다. 종류가 뭉개지면
    // 「매입 전에 취소된 건」과 「매입 후에 돌려준 건」을 나중에 가를 수 없다.
    expect(entries.get(refund)).toMatchObject({
      kind: 'REFUND',
      amount: -50_000,
      balanceAfter: 150_000,
    })
    await expectSound(card.id, 150_000)
  })
})

describe('정합성 (F3)', () => {
  it('keeps the ledger explaining the used amount across twenty transactions', async () => {
    const card = await issue(LIMIT)
    // 정해 둔 대본이다. 무작위로 만들면 어떤 씨앗에서만 실패하는 검사가 되고,
    // 그때 보고되는 것은 결함이 아니라 씨앗이다.
    const script: readonly (readonly ['CHARGE' | 'CANCEL' | 'REFUND', number])[] = [
      ['CHARGE', 120_000],
      ['CHARGE', 250_000],
      ['CANCEL', 70_000],
      ['CHARGE', 400_000],
      ['REFUND', 150_000],
      ['CHARGE', 300_000],
      ['CANCEL', 350_000],
      ['CHARGE', 90_000],
      ['REFUND', 40_000],
      ['CHARGE', 210_000],
      ['CANCEL', 60_000],
      ['CHARGE', 180_000],
      ['REFUND', 480_000],
      ['CHARGE', 120_000],
      ['CANCEL', 20_000],
      ['CHARGE', 330_000],
      ['REFUND', 130_000],
      ['CHARGE', 170_000],
      ['CANCEL', 500_000],
      ['REFUND', 70_000],
    ]

    const expected = new Map<string, number>()
    let used = 0

    for (const [kind, amount] of script) {
      const refId = randomUUID()

      const card_ =
        kind === 'CHARGE'
          ? await cards().charge(card.id, amount, refId)
          : await cards().release(card.id, amount, refId, kind)

      used += kind === 'CHARGE' ? amount : -amount
      expected.set(refId, used)
      // 매 걸음마다 본다. 스무 번째에만 보면 어느 걸음에서 갈라졌는지 알 수 없다.
      expect(card_.usedAmount).toBe(used)
    }

    const entries = await entriesByRef(card.id)

    expect(entries.size).toBe(script.length)
    // 각 행의 `balanceAfter` 는 그 사건 직후의 값이다 — 즉 앞 행의 잔액에 자기
    // 금액을 더한 것. 이 연쇄가 끊기면 합계가 우연히 맞아도 원장은 못 읽는다.
    for (const [refId, balanceAfter] of expected) {
      expect(entries.get(refId)?.balanceAfter).toBe(balanceAfter)
    }

    expect(used).toBe(300_000)
    await expectSound(card.id, used)
  })

  it('finds a card whose used amount somebody moved behind the ledger’s back', async () => {
    const card = await issue(LIMIT)

    await cards().charge(card.id, 300_000, randomUUID())
    // R1 이 말하는 쓰기: 누군가 컬럼에 직접 손을 댄다. 원장은 그대로다.
    await db.execute('UPDATE "VirtualCard" SET "usedAmount" = 200000 WHERE "id" = $1', [card.id])

    expect(await cards().reconcile()).toEqual([
      { cardId: card.id, usedAmount: 200_000, ledgerBalance: 300_000 },
    ])
    // **고치지 않는다.** 대사는 어긋난 곳을 찾아 주는 것이고, 둘 중 무엇이
    // 맞는지는 사람이 정한다 — 조용히 맞춰 버리면 어긋났다는 사실 자체가
    // 사라지고, 그 카드에서 무슨 일이 있었는지 아무도 못 묻게 된다.
    expect((await cardRow(card.id)).usedAmount).toBe(200_000)
  })
})

describe('한도 (F4)', () => {
  it('refuses an approval larger than what is left', async () => {
    const card = await issue(LIMIT)

    await cards().charge(card.id, 600_000, randomUUID())

    const refused = await refusal(cards().charge(card.id, 500_000, randomUUID()))

    // 「지금은 안 된다」가 아니라 「이만큼까지는 된다」이므로, 초과 환불과 같은
    // 성격의 거절이다 (payments 의 `PAYMENT_REFUND_EXCEEDS` 와 같은 409).
    expect(refused.status).toBe(409)
    // 진 요청은 원장에 아무것도 남기지 않았다. 거절하고 사용액만 올린 구현은
    // 상태 이름만 보는 검사를 전부 통과한다.
    expect(await ledgerOf(card.id)).toHaveLength(1)
    await expectSound(card.id, 600_000)
  })

  it('refuses the one won that does not fit, and lets the exact remainder through', async () => {
    const card = await issue(LIMIT)

    await cards().charge(card.id, 900_000, randomUUID())

    // **1원만 넘겨도 거절이다.** `<` 와 `<=` 를 바꿔 쓴 구현은 큰 금액으로만
    // 시험하면 통과한다 — 실제로 새는 것은 언제나 이 한 칸이다.
    expect((await refusal(cards().charge(card.id, 100_001, randomUUID()))).status).toBe(409)
    expect(await ledgerOf(card.id)).toHaveLength(1)

    // 그리고 정확히 남은 만큼은 지나간다. 이 줄이 없으면 위의 거절이 「1원이
    // 넘어서」인지 「두 번째 승인이 그냥 막혀서」인지 구별되지 않는다.
    const full = await cards().charge(card.id, 100_000, randomUUID())

    expect(full.usedAmount).toBe(LIMIT)
    expect(full.creditLimit - full.usedAmount).toBe(0)
    await expectSound(card.id, LIMIT)
  })

  it('refuses an approval of nothing at all', async () => {
    const card = await issue(LIMIT)

    // 0원 승인은 원장 행만 늘리고 아무 한도도 쓰지 않는다. 표에도 같은 규칙이
    // 적혀 있어서(`VirtualCardTransaction_direction_check`) 서비스가 먼저
    // 거절하지 않으면 이 요청은 400 이 아니라 500 이 된다.
    expect((await refusal(cards().charge(card.id, 0, randomUUID()))).status).toBe(400)
    expect((await refusal(cards().charge(card.id, -50_000, randomUUID()))).status).toBe(400)
    expect(await ledgerOf(card.id)).toEqual([])
    await expectSound(card.id, 0)
  })

  it('answers 404 for a card nobody has', async () => {
    expect((await refusal(cards().charge(randomUUID(), 10_000, randomUUID()))).status).toBe(404)
  })
})

describe('취소·환불', () => {
  it('gives the limit back so the room can be used again', async () => {
    const card = await issue(LIMIT)

    await cards().charge(card.id, LIMIT, randomUUID())
    // 한도를 다 쓴 카드다. 취소가 한도를 돌려주지 않으면 이 카드는 영영 못 쓴다.
    expect((await refusal(cards().charge(card.id, 1, randomUUID()))).status).toBe(409)

    const released = await cards().release(card.id, 400_000, randomUUID(), 'CANCEL')

    expect(released.usedAmount).toBe(600_000)
    expect(released.creditLimit - released.usedAmount).toBe(400_000)

    const again = await cards().charge(card.id, 400_000, randomUUID())

    expect(again.usedAmount).toBe(LIMIT)
    await expectSound(card.id, LIMIT)
  })

  it('refuses to give back more than was used', async () => {
    const card = await issue(LIMIT)

    await cards().charge(card.id, 300_000, randomUUID())

    // 쓴 것보다 많이 돌려주면 **쓰지도 않은 한도가 늘어난다.** `usedAmount` 가
    // 음수로 내려가고, 그 카드는 그때부터 한도보다 많이 쓸 수 있다. 표의
    // `VirtualCard_usedAmount_check` 가 마지막 방어선이지만, 거기까지 가면
    // 거절은 500 으로 보이고 사유는 아무 데도 남지 않는다.
    expect((await refusal(cards().release(card.id, 300_001, randomUUID(), 'REFUND'))).status).toBe(
      409,
    )
    expect(await ledgerOf(card.id)).toHaveLength(1)
    await expectSound(card.id, 300_000)

    // 정확히 쓴 만큼은 돌아간다 — 위의 거절이 「1원이 넘어서」였다는 증거다.
    const back = await cards().release(card.id, 300_000, randomUUID(), 'CANCEL')

    expect(back.usedAmount).toBe(0)
    await expectSound(card.id, 0)
  })

  it('refuses a release of nothing at all', async () => {
    const card = await issue(LIMIT)

    await cards().charge(card.id, 100_000, randomUUID())

    expect((await refusal(cards().release(card.id, 0, randomUUID(), 'CANCEL'))).status).toBe(400)
    expect((await refusal(cards().release(card.id, -10_000, randomUUID(), 'REFUND'))).status).toBe(
      400,
    )
    expect(await ledgerOf(card.id)).toHaveLength(1)
    await expectSound(card.id, 100_000)
  })
})

describe('정지·삭제', () => {
  it('refuses an approval on a card its owner stopped', async () => {
    const card = await issue(LIMIT)

    const suspended = await cards().suspend(buyer, card.id)

    expect(suspended.status).toBe('SUSPENDED')
    // 멈춘 카드로 결제가 지나가면 「정지」는 화면의 배지일 뿐이다.
    expect((await refusal(cards().charge(card.id, 10_000, randomUUID()))).status).toBe(409)
    expect(await ledgerOf(card.id)).toEqual([])
    // 멈춘 카드도 목록에는 남는다. 빠지는 것은 지운 카드뿐이고, 보이지 않는
    // 카드는 되살릴 수도 없다.
    expect([...(await cards().list(buyer))].map((listed) => listed.id)).toEqual([card.id])
    await expectSound(card.id, 0)
  })

  it('refuses an approval on a card that is gone', async () => {
    const card = await issue(LIMIT)

    await cards().remove(buyer, card.id)

    // 행은 남아 있다(소프트 삭제) — 없는 카드가 아니라 **상태가 막은** 거절이라
    // 정지된 카드와 같은 409 다.
    expect((await refusal(cards().charge(card.id, 10_000, randomUUID()))).status).toBe(409)
    expect(await ledgerOf(card.id)).toEqual([])
  })

  it('refuses to stop or delete somebody else’s card', async () => {
    const other = await stranger()
    const card = await issue(LIMIT, other)

    // 남의 카드를 멈추거나 지울 수 있으면 그 사람의 결제 수단이 남의 손에 있다.
    //
    // 그리고 답은 「없다」다 — 남의 카드 id 를 넣어 본 사람에게 그 카드가 있는지
    // 없는지를 알려 줄 이유가 없다 (결제 시작이 남의 주문에 404 로 답하는 것과
    // 같은 판단이다).
    expect((await refusal(cards().suspend(buyer, card.id))).status).toBe(404)
    expect((await refusal(cards().remove(buyer, card.id))).status).toBe(404)
    expect((await cardRow(card.id)).status).toBe('ACTIVE')
  })

  it('answers 404 for a card nobody has', async () => {
    expect((await refusal(cards().suspend(buyer, randomUUID()))).status).toBe(404)
    expect((await refusal(cards().remove(buyer, randomUUID()))).status).toBe(404)
  })
})

/**
 * 발급을 몇 번까지 시도해 볼 것인가.
 *
 * 상한을 세어서 그만큼 만드는 대신 **거절당할 때까지** 만든다. 그래야 이 검사가
 * 묻는 것이 「몇 장이 상한인가」가 아니라 **상한이 있는가**가 된다 — 제한이 아예
 * 없는 구현에서는 이 루프가 열두 장을 만들고 `refused` 를 비운 채 끝나고, 그것이
 * 「개수 제한이 없다」의 정확한 모습이다.
 */
const ISSUE_CEILING = 12

interface IssueRun {
  readonly issued: number
  readonly refused: Refusal | null
}

async function issueUntilRefused(owner: RequestPrincipal): Promise<IssueRun> {
  let issued = 0

  for (let attempt = 0; attempt < ISSUE_CEILING; attempt += 1) {
    const error: unknown = await cards()
      .issue(owner, 100_000)
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    if (error !== null) return { issued, refused: refusalOf(error) }

    issued += 1
  }

  return { issued, refused: null }
}

describe('개수 제한 (F6)', () => {
  it('refuses the card past the maximum, and calls it a bad request', async () => {
    const run = await issueUntilRefused(buyer)

    expect(run.refused).not.toBeNull()
    // 400 이다. 상태의 문제가 아니라 「더는 만들 수 없다」는 요청의 문제라,
    // 부르는 쪽이 해야 할 다음 행동이 다르다 (F6).
    expect(run.refused?.status).toBe(400)
    // 그리고 상한은 코드가 말하는 그 수다. 화면이 안내하는 장수와 서비스가 막는
    // 장수가 갈라지면, 사용자는 되지 않는 버튼을 계속 누른다.
    expect(run.issued).toBe(VIRTUAL_CARDS_PER_USER)
    // 진 요청은 카드를 남기지 않았다 — 세는 쪽과 만드는 쪽이 갈라지면 상한은
    // 한 장씩 밀린다.
    expect(await cards().list(buyer)).toHaveLength(run.issued)
  })

  it('does not count another person’s cards against mine', async () => {
    const other = await stranger()

    await issueUntilRefused(buyer)

    // 상한이 계정별이 아니라 전체였다면, 한 사람이 상한까지 발급한 순간
    // 나머지 전원이 카드를 만들지 못한다.
    await expect(cards().issue(other, 100_000)).resolves.toMatchObject({
      creditLimit: 100_000,
      usedAmount: 0,
      status: 'ACTIVE',
    })
  })
})

describe('데모 연동 (F5)', () => {
  it('hands a buyer demo account a card it can actually pay with', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/auth/demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [APP_ID_HEADER]: 'shop' },
      body: JSON.stringify({ role: 'BUYER' }),
    })

    expect(response.status).toBe(200)
    expect(demoIssueResponseSchema.parse(await response.json()).demo.role).toBe('BUYER')

    // 이 발급이 만든 계정 하나. (`beforeEach` 가 만든 실계정과 구별한다.)
    const account = await db.one<{ id: string }>('SELECT "id" FROM "User" WHERE "isDemo" = true')
    const owned = await cards().list(principalOf(account.id))
    const [card] = owned

    // 카드가 없으면 방문자는 결제 화면에서 막힌다 — 그리고 그것이 이 프로젝트가
    // 보여 주려는 흐름의 한가운데다 (TASK-0024 연동).
    expect(owned).toHaveLength(1)
    expect(card).toMatchObject({ usedAmount: 0, status: 'ACTIVE' })
    expect(card?.creditLimit).toBeGreaterThan(0)
    expect(card?.maskedNumber).toMatch(/^9999-\*{4}-\*{4}-\d{4}$/)

    // 장식이 아니라 카드다. 승인이 지나가고 원장에 남는다.
    const charged = await cards().charge(card?.id ?? '', 10_000, randomUUID())

    expect(charged.usedAmount).toBe(10_000)
    await expectSound(card?.id ?? '', 10_000)
  })
})

describe('동시 승인 (F8 · A7)', () => {
  it('refuses the one approval that does not fit when three arrive at once', async () => {
    const card = await issue(LIMIT)
    // 각자 혼자서는 되고 **셋이 함께는 안 되는** 금액이다. 전액을 셋이 시도하면
    // 이 검사가 재는 것은 한도가 아니라 배타성이 된다 — F8 이 묻는 것은 전자다.
    const each = 400_000

    const results = await underContention(card.id, 3, () =>
      cards().charge(card.id, each, randomUUID()),
    )

    expect(fulfilled(results)).toHaveLength(2)
    expect(rejected(results)).toHaveLength(1)
    // 진 쪽은 **금액에서** 졌다. 카드는 여전히 `ACTIVE` 이고 한도도 남아 있으므로
    // 상태가 막아 준 것이 아니다.
    expect(refusalOf(rejected(results)[0]).status).toBe(409)

    // 넘지 않았다. 이것이 F8 이 실제로 지키는 것이고, 「둘만 통과했다」는 그
    // 결과일 뿐이다.
    await expectSound(card.id, each * 2)

    const entries = await ledgerOf(card.id)

    expect(entries).toHaveLength(2)
    // 그리고 뒤에 들어간 쪽은 앞의 결과 **위에서** 잔액을 적었다. 잠금 밖에서
    // 읽고 안에서 쓰는 구현은 두 행 모두 400,000 을 적고, 그 원장은 합계가
    // 800,000 인 카드를 400,000 만 썼다고 말한다.
    expect(entries.map((row) => row.balanceAfter).sort((left, right) => left - right)).toEqual([
      400_000, 800_000,
    ])
  })

  it('adds all three up when they fit together', async () => {
    const card = await issue(LIMIT)
    const each = 300_000

    // 같은 배열이다. 셋 다 통과하는 경우에도 겹쳤다는 것이 먼저 참이어야,
    // 「셋 다 들어갔다」가 직렬 실행의 당연한 결과가 아니게 된다.
    const results = await underContention(card.id, 3, () =>
      cards().charge(card.id, each, randomUUID()),
    )

    // 셋 다 들어갈 자리가 있으므로 셋 다 통과해야 한다. 여기서 하나가 지면
    // 한도가 아니라 **직렬화**를 시험하고 있었던 것이다.
    expect(fulfilled(results)).toHaveLength(3)
    await expectSound(card.id, each * 3)

    const entries = await ledgerOf(card.id)

    expect(entries).toHaveLength(3)
    expect(entries.map((row) => row.balanceAfter).sort((left, right) => left - right)).toEqual([
      300_000, 600_000, 900_000,
    ])
  })
})
