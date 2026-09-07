import type { ReturnReason } from '@shopping/shared'

/**
 * 반품 사진을 **고르는** 단계의 판단 (TASK-0067 F2).
 *
 * 올리는 일과 파일 하나를 받아도 되는지는 `lib/uploads/` 가 한다 — 그 둘은 리뷰
 * 사진과 완전히 같은 일이고(TASK-0083 F6), 두 벌이 되면 갈라지는 것은 코드가 아니라
 * **거절의 기준**이다. 여기 남은 것은 반품에만 있는 물음 하나다: 이 사유에 사진 칸이
 * 있는가.
 *
 * ## 서버 규칙을 왜 여기 또 적는가
 *
 * `apps/api/src/claims/return-rules.ts` 의 `PHOTO_RULE` 이 같은 표를 갖는다. 그런데
 * 화면은 그 답을 **버튼을 누르기 전에** 알아야 한다 — 사유를 고르는 순간 사진 칸이
 * 나타나야 하고, 하자 반품에서 사진을 안 붙인 사람에게는 보내기 전에 말해야 한다.
 * 서버에 물어서 아는 방법이 없다(사유는 요청의 일부이지 조회할 자원이 아니다).
 *
 * 그래서 이 표는 **화면이 무엇을 그릴지**를 정하고, **거절은 여전히 서버의 것**이다
 * (`RETURN_PHOTO_REQUIRED` · `RETURN_PHOTO_NOT_ALLOWED`). 둘이 갈라지면 화면이
 * 못 붙이게 한 사진을 서버가 요구하거나 그 반대가 되는데, 그때도 **서버가 이긴다** —
 * 화면은 그 거절을 문장으로 그릴 자리를 갖고 있다.
 */
const PHOTO_RULE: Readonly<Record<ReturnReason, 'required' | 'forbidden'>> = {
  CHANGE_OF_MIND: 'forbidden',
  DEFECTIVE: 'required',
  WRONG_ITEM: 'required',
}

/** 이 사유에 사진 칸이 있는가. 없으면 붙일 수도 없다. */
export function returnPhotosRequired(reason: ReturnReason): boolean {
  return PHOTO_RULE[reason] === 'required'
}
