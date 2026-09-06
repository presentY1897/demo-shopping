import type { Settlement, SettlementStatus } from '@shopping/shared'

import { inclusiveEnd } from './settlement-console'

/**
 * 정산서 목록을 표 파일로 (F8).
 *
 * ## 왜 브라우저가 만드는가
 *
 * 서버에 `GET /settlements.csv` 를 하나 더 두면 **같은 회차에 대해 두 개의 답**이
 * 생긴다. 화면은 계약을 지나 온 목록을 그리고 파일은 다른 질의를 지나 온 목록을
 * 담는데, 둘이 갈라지는 날 그것을 알아차리는 사람은 아무도 없다 — 파일을 받는
 * 사람은 화면을 보고 있지 않기 때문이다. 여기서 만들면 파일은 **화면이 방금 읽은
 * 바로 그 데이터**이고, 그래서 파일이 화면과 다른 말을 할 수가 없다. (그리고 이
 * TASK 는 `apps/api` 를 고치지 않는다.)
 *
 * ## CSV 이지 `.xlsx` 가 아니다
 *
 * xlsx 를 쓰려면 압축·시트·스타일을 아는 라이브러리를 번들에 넣어야 하고, 그것은
 * 「내보내기」 버튼 하나가 콘솔의 첫 로드에 지우는 비용이 된다. Excel 은 BOM 이
 * 붙은 UTF-8 CSV 를 열고 한글도 깨지 않는다 — 그 세 바이트가 라이브러리를 대신한다.
 * (`apps/seller/src/lib/orders/order-export.ts` 가 같은 판단을 같은 이유로 내렸다.
 * 앱 경계를 넘어 들여올 수 없어 규약을 다시 적었고, 공용으로 옮기는 일은 이 TASK 의
 * 소유 경로 밖이다.)
 *
 * I/O 가 없다. 파일을 만드는 일(`Blob` · 링크 클릭)은 브라우저의 것이고 여기서는
 * **문자열까지만** 만든다 — 그래야 「무엇이 어떤 칸에 들어가는가」가 단위 검사에서
 * 닿는다 (`vitest.config.mjs` 가 이 파일을 분기 100% 로 잡고 있다).
 */

/** Excel 에게 이 파일이 UTF-8 이라고 말하는 세 바이트. */
export const CSV_BOM = '﻿'

/**
 * 한 칸.
 *
 * 큰따옴표로 감싸고 안의 큰따옴표를 겹쳐 쓴다(RFC 4180). **언제나** 감싸는 이유는
 * 「필요할 때만」이 판단이고, 그 판단이 한 번 틀리면 쉼표 하나가 열을 밀어 **아래
 * 모든 값이 한 칸씩 어긋난** 파일이 나오기 때문이다 — 그 파일은 열리고, 읽히고,
 * 틀린다. 보류 사유에는 쉼표도 줄바꿈도 큰따옴표도 사람이 직접 적는다.
 */
export function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`
}

export function csvRow(cells: readonly (string | number)[]): string {
  return cells.map((cell) => csvCell(cell)).join(',')
}

/** 내보내기가 만드는 열 — 이 인터페이스의 순서가 곧 파일의 열 순서다. */
export interface SettlementExportColumns {
  readonly periodStart: string
  readonly periodEnd: string
  readonly brandName: string
  readonly status: string
  readonly salesAmount: string
  readonly commissionAmount: string
  readonly sellerCouponAmount: string
  readonly returnAdjustmentAmount: string
  readonly payoutAmount: string
  readonly holdReason: string
}

export interface SettlementExportOptions {
  readonly columns: SettlementExportColumns
  readonly statusLabels: Readonly<Record<SettlementStatus, string>>
  /**
   * 보류된 적이 없는 줄의 사유 칸.
   *
   * **화면과 달리 여기서는 빈칸이 맞다.** 표에서는 빈칸이 「없다」와 「못 읽었다」를
   * 섞기 때문에 `—` 를 그리지만, 스프레드시트에서 그 대시는 정렬과 필터에 걸리는
   * **값**이 된다 — 사유가 적힌 줄만 골라 보려는 사람이 가장 먼저 하는 일이 그
   * 열의 빈칸을 거르는 것이다. 그래도 값으로 받는 이유는 로케일이 다르게 정할 수
   * 있어서다.
   */
  readonly emptyHoldReason: string
  /** 회차의 두 날짜를 사람이 읽는 문자열로. 앱의 포맷터를 그대로 받는다. */
  readonly formatDay: (isoString: string) => string
}

/**
 * 목록을 CSV 문자열로.
 *
 * ## 금액은 **서식 없는 정수**다
 *
 * `₩1,890,000` 을 넣으면 스프레드시트가 그것을 문자열로 읽고, 그 열은 더해지지
 * 않는다 — 내보내기를 받는 사람이 첫 번째로 하는 일이 합계를 내는 일인데도. 통화
 * 기호도 천 단위 구분도 화면의 것이고, 파일에는 `1890000` 이 간다. 음수도 그대로다:
 * 반품 차감은 `-120000` 이고, 그래야 지급액 열과 세로로 더해진다.
 *
 * ## 회차의 끝은 **포함하는 날**로 적는다
 *
 * 계약의 `periodEnd` 는 다음 회차의 시작과 맞물린 열린 끝이라, 그대로 적으면
 * 8월 24일 회차의 끝이 8월 31일이 되고 다음 회차의 시작도 8월 31일이 된다. 파일을
 * 정렬해 읽는 사람에게 그것은 하루가 두 번 세어진 것으로 보인다. {@link inclusiveEnd}
 * 가 그 하루를 되돌리고, 그 일을 부르는 쪽에 맡기지 않는 이유는 **화면과 파일이
 * 같은 회차를 다르게 적는 일**을 만들지 않기 위해서다.
 */
export function settlementsToCsv(
  rows: readonly Settlement[],
  options: SettlementExportOptions,
): string {
  const { columns } = options
  const header = csvRow([
    columns.periodStart,
    columns.periodEnd,
    columns.brandName,
    columns.status,
    columns.salesAmount,
    columns.commissionAmount,
    columns.sellerCouponAmount,
    columns.returnAdjustmentAmount,
    columns.payoutAmount,
    columns.holdReason,
  ])
  const body = rows.map((row) =>
    csvRow([
      options.formatDay(row.periodStart),
      options.formatDay(inclusiveEnd(row.periodEnd)),
      row.brandName,
      options.statusLabels[row.status],
      row.salesAmount,
      row.commissionAmount,
      row.sellerCouponAmount,
      row.returnAdjustmentAmount,
      row.payoutAmount,
      row.holdReason ?? options.emptyHoldReason,
    ]),
  )

  // `\r\n` 은 RFC 4180 이 정한 줄바꿈이고, Excel 이 `\n` 만으로도 열기는 하지만
  // 옛 버전에서 한 줄로 붙는다.
  return `${CSV_BOM}${[header, ...body].join('\r\n')}\r\n`
}

/** `settlements_20260906.csv` — 날짜가 붙는 이유는 두 번 받으면 두 파일이어야 해서다. */
export function exportFileName(prefix: string, now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')

  return `${prefix}_${stamp}.csv`
}
