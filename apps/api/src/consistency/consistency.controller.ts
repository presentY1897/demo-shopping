import { Controller, Get } from '@nestjs/common'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { ConsistencyReport } from './consistency.service.js'
import { ConsistencyService } from './consistency.service.js'
import { accessDenied } from '../auth/access-denied.js'
import { grantedScopes } from '@shopping/shared'

/**
 * 정합성 점검을 지금 돌린다 (TASK-0097 F7).
 *
 * ## `GET` 인데 무거운 이유
 *
 * 이 문은 **읽기다** — 일곱 축을 세고 아무것도 고치지 않는다. 무겁다는 이유로
 * `POST` 로 두면 「고치는 문」처럼 보이고, 이 배치가 절대 안 고친다는 것이 설계의
 * 핵심이라 그 오해를 만들지 않는다.
 *
 * 주기 실행을 붙이지 않았다. 전 테이블을 훑는 일이라 무료 인스턴스에서 15분마다
 * 돌리면 그동안 다른 요청이 느려지고, **불일치는 몇 분 안에 고칠 수 있는 종류의
 * 문제가 아니다** — 사람이 보러 올 때 도는 것으로 충분하다.
 */
@Controller({ path: 'admin/consistency', version: '1' })
export class ConsistencyController {
  constructor(private readonly consistency: ConsistencyService) {}

  @Get()
  @RequirePermission('order.read')
  check(@Principal() principal: RequestPrincipal): Promise<ConsistencyReport> {
    // 라우트의 데코레이터는 이름만 본다 — 구매자도 `order.read` 를 갖고 있다.
    if (!grantedScopes(principal, 'order.read').includes('any')) {
      throw accessDenied('order.read', 'out_of_scope')
    }

    return this.consistency.check()
  }
}
