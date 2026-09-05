import type { SellerOrderListItem } from '@shopping/shared'

/**
 * 주문 목록을 표 파일로 (TASK-0060 2장).
 *
 * **CSV 이지 `.xlsx` 가 아니다.** xlsx 를 쓰려면 압축·시트·스타일을 아는 라이브러리를
 * 번들에 넣어야 하고, 그것은 「내보내기」 버튼 하나가 콘솔의 첫 로드에 지우는 비용이
 * 된다. Excel 은 BOM 이 붙은 UTF-8 CSV 를 열고 한글도 깨지 않는다 — 그 한 바이트
 * 셋이 라이브러리를 대신한다.
 *
 * **BOM 이 진짜로 필요하다.** 없으면 Excel 이 시스템 코드페이지로 읽어 한글이 전부
 * 깨지고, 증상은 「내보내기가 깨진다」이지 「인코딩을 안 알려 줬다」가 아니다. 다른
 * 도구는 BOM 을 무시하므로 잃는 것이 없다.
 *
 * I/O 가 없다. 파일을 만드는 일(`Blob` · 링크 클릭)은 브라우저의 것이고 여기서는
 * **문자열까지만** 만든다 — 그래야 「무엇이 어떤 칸에 들어가는가」가 단위 테스트에서
 * 닿는다.
 */

/** Excel 에게 이 파일이 UTF-8 이라고 말하는 세 바이트. */
export const CSV_BOM = '﻿'

/**
 * 한 칸.
 *
 * 큰따옴표로 감싸고 안의 큰따옴표를 겹쳐 쓴다(RFC 4180). **언제나** 감싸는 이유는
 * 「필요할 때만」이 판단이고, 그 판단이 한 번 틀리면 쉼표 하나가 열을 밀어 **아래
 * 모든 값이 한 칸씩 어긋난** 파일이 나오기 때문이다 — 그 파일은 열리고, 읽히고,
 * 틀린다.
 */
export function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`
}

export function csvRow(cells: readonly (string | number)[]): string {
  return cells.map((cell) => csvCell(cell)).join(',')
}

/** 내보내기가 만드는 열 — 순서가 곧 파일의 열 순서다. */
export interface OrderExportColumns {
  readonly orderNumber: string
  readonly orderedAt: string
  readonly status: string
  readonly recipient: string
  readonly headline: string
  readonly itemCount: string
  readonly totalQuantity: string
  readonly paidAmount: string
  readonly trackingNumber: string
}

export interface OrderExportOptions {
  readonly columns: OrderExportColumns
  readonly statusLabels: Readonly<Record<string, string>>
  /** 발송 전 줄의 운송장 칸. 빈 칸으로 두면 「없다」와 「못 읽었다」가 같아진다. */
  readonly emptyTracking: string
  /** 시각을 사람이 읽는 문자열로. 앱의 포맷터를 그대로 받는다. */
  readonly formatDate: (isoString: string) => string
}

/**
 * 목록을 CSV 문자열로.
 *
 * **가려진 이름을 그대로 내보낸다.** 파일로 나가는 순간 그것은 우리가 통제하지 못하는
 * 곳에 남으므로, 목록에 가려 보여 준 값을 파일에서 되돌리는 것은 가린 이유를 없애는
 * 일이다. 전체 이름이 필요하면 그것은 한 건을 여는 일이고, 그 화면이 따로 있다.
 */
export function ordersToCsv(
  rows: readonly SellerOrderListItem[],
  options: OrderExportOptions,
): string {
  const header = csvRow([
    options.columns.orderNumber,
    options.columns.orderedAt,
    options.columns.status,
    options.columns.recipient,
    options.columns.headline,
    options.columns.itemCount,
    options.columns.totalQuantity,
    options.columns.paidAmount,
    options.columns.trackingNumber,
  ])
  const body = rows.map((row) =>
    csvRow([
      row.orderNumber,
      options.formatDate(row.orderedAt),
      options.statusLabels[row.status] ?? row.status,
      row.maskedRecipientName,
      row.headline,
      row.itemCount,
      row.totalQuantity,
      row.paidAmount,
      row.trackingNumber ?? options.emptyTracking,
    ]),
  )

  // `\r\n` 은 RFC 4180 이 정한 줄바꿈이고, Excel 이 `\n` 만으로도 열기는 하지만
  // 옛 버전에서 한 줄로 붙는다.
  return `${CSV_BOM}${[header, ...body].join('\r\n')}\r\n`
}

/** `주문내역_20260906.csv` — 날짜가 붙는 이유는 두 번 받으면 두 파일이어야 해서다. */
export function exportFileName(prefix: string, now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')

  return `${prefix}_${stamp}.csv`
}
