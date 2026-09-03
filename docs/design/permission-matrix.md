# 역할 × 퍼미션 매트릭스

> **이 파일은 생성물이다. 직접 수정하지 마라.**
> 출처는 `packages/shared/src/auth/role-permissions.ts` 이고,
> `pnpm --filter @shopping/api docs:matrix` 로 다시 만든다.
> 코드와 어긋나면 `apps/api/src/auth/permission-matrix.spec.ts` 가 CI 에서 실패한다.

퍼미션은 **무엇을 할 수 있나**만 답한다. **누구 것에** 할 수 있는지는 스코프가 답한다.

| 스코프 | 의미 |
| --- | --- |
| `own` | 자기가 소유한 리소스만 (판매자 → 자기 스토어, 구매자 → 자기 주문) |
| `demo` | 데모 계정이 만든 리소스만. 시드·실계정 데이터는 조회만 |
| `any` | 전부 |
| — | 권한 없음. **기본 거부** — 표에 없는 조합은 전부 403 |

## 매트릭스

| 퍼미션 | BUYER | SELLER_OWNER | ADMIN_OPERATOR | ADMIN_SUPER | DEMO_ADMIN |
| --- | --- | --- | --- | --- | --- |
| `catalog.read` | `any` | `any` | `any` | `any` | `any` |
| `catalog.write` | — | — | `any` | `any` | `demo` |
| `catalog.delete` | — | — | — | `any` | — |
| `product.read` | `any` | `own` | `any` | `any` | `any` |
| `product.write` | — | `own` | `any` | `any` | `demo` |
| `product.delete` | — | `own` | — | `any` | — |
| `media.upload` | — | `own` | `any` | `any` | `demo` |
| `order.read` | `own` | `own` | `any` | `any` | `any` |
| `order.write` | `own` | `own` | — | `any` | — |
| `claim.read` | `own` | `own` | `any` | `any` | `any` |
| `claim.handle` | — | `own` | `any` | `any` | `demo` |
| `coupon.read` | `own` | `own` | `any` | `any` | `any` |
| `coupon.write` | — | `own` | `any` | `any` | `demo` |
| `coupon.delete` | — | `own` | — | `any` | — |
| `settlement.read` | — | `own` | `any` | `any` | `any` |
| `settlement.approve` | — | — | — | `any` | — |
| `settlement.pay` | — | — | — | `any` | — |
| `user.read` | `own` | `own` | `any` | `any` | `any` |
| `user.write` | — | — | — | `any` | — |
| `user.delete` | — | — | — | `any` | — |
| `seller.read` | `any` | `own` | `any` | `any` | `any` |
| `seller.approve` | — | — | `any` | `any` | `demo` |
| `seller.suspend` | — | — | — | `any` | — |
| `demo.manage` | — | — | `any` | `any` | `demo` |

## 역할별 요약

### BUYER

퍼미션 8개 — `catalog.read:any` · `product.read:any` · `seller.read:any` · `order.read:own` · `order.write:own` · `claim.read:own` · `coupon.read:own` · `user.read:own`

### SELLER_OWNER

퍼미션 15개 — `catalog.read:any` · `product.read:own` · `product.write:own` · `product.delete:own` · `media.upload:own` · `order.read:own` · `order.write:own` · `claim.read:own` · `claim.handle:own` · `coupon.read:own` · `coupon.write:own` · `coupon.delete:own` · `settlement.read:own` · `seller.read:own` · `user.read:own`

### ADMIN_OPERATOR

퍼미션 15개 — `catalog.read:any` · `catalog.write:any` · `product.read:any` · `product.write:any` · `media.upload:any` · `order.read:any` · `claim.read:any` · `claim.handle:any` · `coupon.read:any` · `coupon.write:any` · `settlement.read:any` · `user.read:any` · `seller.read:any` · `seller.approve:any` · `demo.manage:any`

### ADMIN_SUPER

퍼미션 24개 — `catalog.read:any` · `catalog.write:any` · `catalog.delete:any` · `product.read:any` · `product.write:any` · `product.delete:any` · `media.upload:any` · `order.read:any` · `order.write:any` · `claim.read:any` · `claim.handle:any` · `coupon.read:any` · `coupon.write:any` · `coupon.delete:any` · `settlement.read:any` · `settlement.approve:any` · `settlement.pay:any` · `user.read:any` · `user.write:any` · `user.delete:any` · `seller.read:any` · `seller.approve:any` · `seller.suspend:any` · `demo.manage:any`

### DEMO_ADMIN

퍼미션 15개 — `catalog.read:any` · `catalog.write:demo` · `product.read:any` · `product.write:demo` · `media.upload:demo` · `order.read:any` · `claim.read:any` · `claim.handle:demo` · `coupon.read:any` · `coupon.write:demo` · `settlement.read:any` · `user.read:any` · `seller.read:any` · `seller.approve:demo` · `demo.manage:demo`

---

퍼미션 24개 · 역할 5개.
`DEMO_ADMIN` 은 `ADMIN_OPERATOR` 에서 파생된다 — 쓰기 권한만 `demo` 로 좁히고 읽기는 그대로 둔다.
