/**
 * 아직 열리지 않은 화면의 자리 (TASK-0063).
 *
 * ## 왜 링크도 비활성 버튼도 아닌가
 *
 * 이 저장소는 껍데기 라우트를 없애면서 규칙을 하나 정했다 — **죽은 링크나 비활성
 * 컨트롤 대신 무엇이 언제 열리는지 말한다** (`docs/design/pages.md` 「껍데기 라우트는
 * 이제 없다」). 셋 다 이유가 있다.
 *
 * | 하지 않는 것 | 왜 |
 * | --- | --- |
 * | 없는 라우트로 가는 `<Link>` | 404 로 보낸다. 탭 순회에 목적지 없는 정지가 생긴다 |
 * | `disabled` 버튼 | 탭으로 닿지 못하므로 **왜 못 누르는지 알 수 없다** |
 * | `aria-disabled` 버튼 | 닿기는 하지만 눌러도 아무 일이 없다. 사유를 툴팁에 숨기게 된다 |
 *
 * 남는 것은 문장이다. 그래서 이것은 컨트롤이 아니라 `role="note"` 인 한 문단이고,
 * 그 화면이 생기는 날 **이 컴포넌트를 쓰는 자리가 버튼으로 바뀐다.**
 *
 * ## 그 날을 어떻게 찾나
 *
 * 쓰는 쪽에 TASK 번호를 주석으로 적는다. 그 TASK 를 여는 사람이
 * `grep -rn 'TASK-0083' apps/shop` 으로 여기 닿는다.
 *
 * **실제로 그렇게 닫힌 자리가 하나 있다.** `seller-order-bundle.tsx` 의 취소·반품
 * 자리는 TASK-0066 이 오면서 문장에서 **버튼으로** 바뀌었고, 「지금 신청할 수
 * 있는가」는 그때부터 서버가 답한다 — 못 하는 경우도 감추지 않고 이유를 말하므로
 * 이 컴포넌트가 하던 일까지 그쪽이 가져갔다. 남은 사용처는 **TASK-0083**(리뷰
 * 작성) 하나다.
 */
export function UpcomingEntry({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div
      className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border border-dashed p-3"
      role="note"
    >
      <p className="text-fg text-sm font-medium">{title}</p>
      <p className="text-fg-muted text-sm">{body}</p>
    </div>
  )
}
