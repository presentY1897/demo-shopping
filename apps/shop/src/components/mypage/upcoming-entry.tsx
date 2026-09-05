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
 * 쓰는 쪽에 TASK 번호를 주석으로 적는다. `seller-order-bundle.tsx` 가
 * **TASK-0066**(취소 신청) · **TASK-0067**(반품 신청) · **TASK-0083**(리뷰 작성)을
 * 그렇게 달고 있고, 그 TASK 를 여는 사람이 `grep -rn 'TASK-0066' apps/shop` 으로
 * 여기 닿는다.
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
