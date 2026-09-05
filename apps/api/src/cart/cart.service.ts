import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type {
  AddCartItemRequest,
  CartGroup,
  CartItem,
  CartResponse,
  MergeCartRequest,
  RemoveCartItemsRequest,
  UpdateCartItemRequest,
} from '@shopping/shared'
import { CART_ITEM_MAX_QUANTITY, CART_MAX_ITEMS } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { noticesFor } from './cart-notices.js'

/**
 * 장바구니 (TASK-0045).
 *
 * **경로에 사용자 id 가 없다** (4.3). 라우트는 전부 `/cart` 이고 소유자는 토큰이
 * 정한다 — 남을 가리킬 방법이 애초에 없으므로 「남의 장바구니를 봤다」가 표현
 * 불가능하다. `assertResourceAccess` 는 그래도 두 번째 방어선으로 남는다: 스코프가
 * `demo` 로 좁혀진 역할이 실계정을 만지는 것을 막는 것은 그쪽이다.
 *
 * **재고를 예약하지 않는다** (D-026). 담을 때 확인만 하고 잠그지는 않는다 — 담고
 * 안 사는 사람 때문에 재고가 묶이면 파는 쪽이 손해이고, 예약은 주문서에 들어갈
 * 때다(TASK-0048).
 *
 * 그래서 **담을 때 통과한 수량이 조회할 때 여전히 살 수 있다는 보장은 없다.** 그
 * 간극을 메우는 것이 `notices` 다 — 거절이 아니라 알림이다.
 */

interface CartLineRow {
  readonly id: string
  readonly quantity: number
  readonly priceAtAdded: number
  readonly variant: {
    readonly id: string
    readonly sku: string
    readonly price: number
    readonly stock: number
    readonly isActive: boolean
    readonly deletedAt: Date | null
    readonly sellerId: string
    readonly optionValues: readonly {
      readonly optionValue: { readonly value: string; readonly optionId: string }
    }[]
    readonly product: {
      readonly id: string
      readonly name: string
      readonly status: string
      readonly deletedAt: Date | null
      readonly maxPurchaseQuantity: number | null
      readonly images: readonly { readonly url: string }[]
      readonly options: readonly { readonly id: string; readonly sortOrder: number }[]
      readonly seller: { readonly id: string; readonly brandName: string }
    }
  }
}

/** 팔 수 있는 조합인가 — 상품이 살아 있고 `ACTIVE` 이며 Variant 도 살아 있는가. */
function isSellable(line: CartLineRow): boolean {
  const { variant } = line

  return (
    variant.deletedAt === null &&
    variant.isActive &&
    variant.product.deletedAt === null &&
    variant.product.status === 'ACTIVE'
  )
}

/**
 * 「블랙 / M」. 상품 자신의 축 순서대로다.
 *
 * 축 순서를 지키는 이유는 읽는 사람 때문이다 — 「M / 블랙」과 「블랙 / M」이 줄마다
 * 섞이면 같은 상품의 두 줄이 다른 물건처럼 보인다.
 */
function optionLabelOf(line: CartLineRow): string {
  const order = new Map(line.variant.product.options.map((option) => [option.id, option.sortOrder]))

  return [...line.variant.optionValues]
    .sort(
      (left, right) =>
        (order.get(left.optionValue.optionId) ?? 0) - (order.get(right.optionValue.optionId) ?? 0),
    )
    .map((entry) => entry.optionValue.value)
    .join(' / ')
}

/** 상품 기본값이 이미 풀린 1회 구매 상한 (TASK-0032 4.1). */
function purchaseLimitOf(line: CartLineRow, variantLimit: number | null): number | null {
  return variantLimit ?? line.variant.product.maxPurchaseQuantity
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /** 판매자별로 묶인 장바구니 (F3). */
  async get(principal: RequestPrincipal): Promise<CartResponse> {
    const account = await this.account(principal, 'cart.read')
    const lines = await this.linesOf(account.id)

    return present(lines)
  }

  /**
   * 담기. 같은 Variant 면 수량이 합산된다 (F1).
   *
   * 합산이 F2c 의 핵심이다 — 2개 담고 다시 1개를 담으면 검사할 것은 1이 아니라
   * **3** 이다. 요청의 수량만 보면 상한을 우회할 수 있다.
   */
  async add(principal: RequestPrincipal, input: AddCartItemRequest): Promise<CartResponse> {
    const account = await this.account(principal, 'cart.write')
    const cartId = await this.ensureCart(account.id)

    await this.prisma.$transaction(async (tx) => {
      // 이 계정의 담기를 직렬화한다 (A7). 잠금이 없으면 동시에 담은 둘이 모두
      // 「지금 0개 있으니 2개는 괜찮다」를 읽고 둘 다 통과해 4개가 된다.
      await lockCart(tx, cartId)

      const held = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId, variantId: input.variantId } },
        select: { id: true, quantity: true },
      })
      const wanted = (held?.quantity ?? 0) + input.quantity

      const variant = await this.assertOrderable(tx, input.variantId, wanted)

      if (held === null) {
        const count = await tx.cartItem.count({ where: { cartId } })

        if (count >= CART_MAX_ITEMS) {
          throw new ConflictException(
            domainFailure('CART_FULL', '장바구니가 가득 찼어요.', {
              params: { max: CART_MAX_ITEMS },
            }),
          )
        }

        await tx.cartItem.create({
          data: {
            cartId,
            variantId: variant.id,
            sellerId: variant.sellerId,
            quantity: wanted,
            priceAtAdded: variant.price,
          },
        })

        return
      }

      // 이미 있던 줄은 **가격 기준선을 갱신하지 않는다.** 「담을 때 얼마였나」의
      // 담은 때는 처음 담은 때이고, 다시 담았다고 해서 그 사이의 인상을 못 본 것이
      // 되지는 않는다.
      await tx.cartItem.update({ where: { id: held.id }, data: { quantity: wanted } })
    })

    return this.get(principal)
  }

  /** 수량 대입. 합산이 아니다 — 다른 동사이므로 다른 라우트다. */
  async update(
    principal: RequestPrincipal,
    itemId: string,
    input: UpdateCartItemRequest,
  ): Promise<CartResponse> {
    const account = await this.account(principal, 'cart.write')
    const cartId = await this.ensureCart(account.id)

    await this.prisma.$transaction(async (tx) => {
      await lockCart(tx, cartId)

      const held = await tx.cartItem.findFirst({
        where: { id: itemId, cartId },
        select: { id: true, variantId: true },
      })

      // 자기 장바구니의 줄이 아니면 **없는 것**이다. 「남의 줄입니다」는 그 줄이
      // 존재한다는 사실을 알려 준다.
      if (held === null) throw new NotFoundException('장바구니에서 찾을 수 없어요.')

      await this.assertOrderable(tx, held.variantId, input.quantity)
      await tx.cartItem.update({ where: { id: held.id }, data: { quantity: input.quantity } })
    })

    return this.get(principal)
  }

  /** 선택 삭제. 하나를 지우는 것도 이쪽이다. */
  async remove(principal: RequestPrincipal, input: RemoveCartItemsRequest): Promise<CartResponse> {
    const account = await this.account(principal, 'cart.write')
    // 잠그지 않는다. 삭제는 읽고 나서 쓰는 것이 아니라 한 문장이고, 조건에
    // `cartId` 가 들어 있어 남의 줄에는 닿지 않는다.
    const cartId = await this.ensureCart(account.id)

    // `cartId` 를 조건에 함께 두는 것이 소유권 검사다. 남의 줄 id 를 섞어 보내면
    // 그것만 지워지지 않는다 — 거절이 아니라 무시이고, 그쪽이 옳다: 요청한 사람이
    // 볼 수 있는 결과는 「내 것이 지워졌다」로 같다.
    await this.prisma.cartItem.deleteMany({ where: { cartId, id: { in: [...input.itemIds] } } })

    return this.get(principal)
  }

  /**
   * 비로그인 장바구니를 합친다 (F6).
   *
   * **거절하지 않는다.** 상한을 넘으면 상한까지만 남기고, 살 수 없게 된 것은 조용히
   * 건너뛴다. 로그인 직후에 「장바구니를 합칠 수 없습니다」를 보여 주는 것은 아무도
   * 원하지 않는 화면이고, 그때 사람이 할 수 있는 일도 없다.
   */
  async merge(principal: RequestPrincipal, input: MergeCartRequest): Promise<CartResponse> {
    const account = await this.account(principal, 'cart.write')
    const cartId = await this.ensureCart(account.id)

    await this.prisma.$transaction(async (tx) => {
      await lockCart(tx, cartId)

      for (const wanted of input.items) {
        const variant = await tx.productVariant.findFirst({
          where: { id: wanted.variantId, deletedAt: null, isActive: true },
          select: {
            id: true,
            sellerId: true,
            price: true,
            stock: true,
            maxPurchaseQuantity: true,
            product: { select: { status: true, deletedAt: true, maxPurchaseQuantity: true } },
          },
        })

        // 두 문장으로 나눈 것은 좁히기 때문이다. `variant?.x != null` 은 `variant`
        // 가 null 일 때 그냥 통과하고, 아래에서 다시 null 이 된다.
        if (variant === null) continue
        if (variant.product.deletedAt !== null || variant.product.status !== 'ACTIVE') continue

        const held = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId, variantId: variant.id } },
          select: { id: true, quantity: true },
        })
        const cap = Math.min(
          CART_ITEM_MAX_QUANTITY,
          variant.stock,
          variant.maxPurchaseQuantity ??
            variant.product.maxPurchaseQuantity ??
            Number.MAX_SAFE_INTEGER,
        )
        const quantity = Math.min((held?.quantity ?? 0) + wanted.quantity, cap)

        if (quantity < 1) continue

        if (held === null) {
          const count = await tx.cartItem.count({ where: { cartId } })

          if (count >= CART_MAX_ITEMS) break

          await tx.cartItem.create({
            data: {
              cartId,
              variantId: variant.id,
              sellerId: variant.sellerId,
              quantity,
              priceAtAdded: variant.price,
            },
          })
        } else {
          await tx.cartItem.update({ where: { id: held.id }, data: { quantity } })
        }
      }
    })

    return this.get(principal)
  }

  // ---------------------------------------------------------------- 내부

  /**
   * 부르는 사람의 계정 행. 반환 타입이 `AccountRow` 인 것이 중요하다 — 이 파일이
   * 데모 플래그의 **이름을 적지 않는다** (TASK-0105 F8). 적으면
   * `demo-containment.spec.ts` 가 빨개진다: 그 이름이 `resource-ownership.ts`
   * 밖으로 새는 것을 막는 것이 그 검사의 일이고, 실제로 여기서 잡혔다.
   */
  private async account(
    principal: RequestPrincipal,
    permission: 'cart.read' | 'cart.write',
  ): Promise<AccountRow> {
    const account = await this.prisma.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('계정을 찾을 수 없어요.')

    assertResourceAccess(principal, permission, accountOwnership(account))

    return account
  }

  /**
   * 장바구니 행이 있게 한다. **트랜잭션 밖에서** 한다.
   *
   * 안에서 하면 안 되는 이유가 Postgres 에 있다: 트랜잭션 안에서 한 문장이
   * 실패하면 **그 트랜잭션 전체가 중단된다.** 두 요청이 동시에 장바구니를 만들면
   * 진 쪽은 유니크 위반을 받고, 그것을 잡아 다시 읽어도 이미 늦었다 — 이후의 모든
   * 문장이 「current transaction is aborted」로 거절된다.
   *
   * 실제로 그 상태였다. 같은 상품을 동시에 세 번 담았더니 수량이 3이 아니라 1이
   * 됐다 — 두 트랜잭션이 중단됐기 때문이고, 증상은 「담기가 가끔 안 먹는다」였다.
   *
   * 그래서 만드는 일은 밖에서, 각자의 문장으로 한다. 실패해도 중단될 트랜잭션이
   * 없다.
   */
  private async ensureCart(userId: string): Promise<string> {
    const held = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } })

    if (held !== null) return held.id

    try {
      const created = await this.prisma.cart.create({ data: { userId }, select: { id: true } })

      return created.id
    } catch {
      // `Cart_userId_key` 가 「계정당 하나」를 지킨다. 진 쪽은 이긴 쪽이 만든 것을
      // 읽는다 — 애플리케이션의 find-or-create 는 이 경합에서 둘 다 통과시킨다.
      const raced = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } })

      if (raced === null) throw new ConflictException('장바구니를 만들지 못했어요.')

      return raced.id
    }
  }

  /**
   * 이 수량을 담을 수 있는가 (F2 · F2b · F2c).
   *
   * 재고 초과와 구매 상한은 **다른 코드**다. 재고는 기다리면 늘어날 수 있고 상한은
   * 늘어나지 않으므로, 사람이 할 일이 다르다.
   */
  private async assertOrderable(
    client: Pick<PrismaService, 'productVariant'>,
    variantId: string,
    quantity: number,
  ): Promise<{ readonly id: string; readonly sellerId: string; readonly price: number }> {
    const variant = await client.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        price: true,
        stock: true,
        isActive: true,
        maxPurchaseQuantity: true,
        product: { select: { status: true, deletedAt: true, maxPurchaseQuantity: true } },
      },
    })

    if (
      variant === null ||
      !variant.isActive ||
      variant.product.deletedAt !== null ||
      variant.product.status !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        domainFailure('CART_ITEM_UNAVAILABLE', '지금은 판매하지 않는 상품이에요.'),
      )
    }

    const limit = variant.maxPurchaseQuantity ?? variant.product.maxPurchaseQuantity

    if (limit !== null && quantity > limit) {
      throw new BadRequestException(
        domainFailure('CART_PURCHASE_LIMIT', `1회 ${String(limit)}개까지 구매할 수 있어요.`, {
          field: 'quantity',
          params: { max: limit },
        }),
      )
    }

    if (quantity > variant.stock) {
      throw new BadRequestException(
        domainFailure('CART_STOCK_EXCEEDED', `재고가 ${String(variant.stock)}개 남았어요.`, {
          field: 'quantity',
          params: { stock: variant.stock },
        }),
      )
    }

    return variant
  }

  /** 한 질의로 장바구니 전체 (A5). */
  private async linesOf(userId: string): Promise<readonly CartLineRow[]> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: {
        /**
         * 한 질의로 장바구니 전체 (A5).
         *
         * 인라인이다 — 밖으로 뽑으면 `orderBy: { sortOrder: 'asc' }` 의 `'asc'` 가
         * `string` 으로 넓어져 Prisma 가 거절한다. `as const` 를 붙이면 이번에는
         * 읽기 전용 튜플이 되어 또 거절한다.
         */
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            quantity: true,
            priceAtAdded: true,
            variant: {
              select: {
                id: true,
                sku: true,
                price: true,
                stock: true,
                isActive: true,
                deletedAt: true,
                sellerId: true,
                optionValues: {
                  select: { optionValue: { select: { value: true, optionId: true } } },
                },
                product: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    deletedAt: true,
                    maxPurchaseQuantity: true,
                    images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
                    options: { select: { id: true, sortOrder: true } },
                    seller: { select: { id: true, brandName: true } },
                  },
                },
              },
            },
          },
        },
      },
    })

    return cart?.items ?? []
  }
}

/** 줄들을 판매자별로 묶는다. 순수 변환이라 서비스 밖에 둔다. */
function present(lines: readonly CartLineRow[]): CartResponse {
  const groups = new Map<string, { brandName: string; items: CartItem[] }>()

  for (const line of lines) {
    const seller = line.variant.product.seller
    const bucket = groups.get(seller.id) ?? { brandName: seller.brandName, items: [] }

    bucket.items.push({
      id: line.id,
      variantId: line.variant.id,
      productId: line.variant.product.id,
      productName: line.variant.product.name,
      optionLabel: optionLabelOf(line),
      thumbnailUrl: line.variant.product.images[0]?.url ?? null,
      sku: line.variant.sku,
      quantity: line.quantity,
      price: line.variant.price,
      priceAtAdded: line.priceAtAdded,
      stock: line.variant.stock,
      maxPurchaseQuantity: purchaseLimitOf(line, null),
      notices: [
        ...noticesFor({
          quantity: line.quantity,
          priceAtAdded: line.priceAtAdded,
          price: line.variant.price,
          stock: line.variant.stock,
          sellable: isSellable(line),
        }),
      ],
    })

    groups.set(seller.id, bucket)
  }

  const presented: CartGroup[] = [...groups.entries()].map(([sellerId, bucket]) => ({
    sellerId,
    brandName: bucket.brandName,
    items: bucket.items,
    productAmount: bucket.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  }))

  return {
    groups: presented,
    totalProductAmount: presented.reduce((sum, group) => sum + group.productAmount, 0),
    itemCount: lines.length,
  }
}

/**
 * `SELECT … FOR UPDATE` on one cart row.
 *
 * Raw because Prisma has no lock clause. The row is only ever read here to be
 * blocked on — what it holds is of no interest.
 */
async function lockCart(client: unknown, cartId: string): Promise<void> {
  const runner = client as {
    $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  }

  await runner.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cartId}::uuid FOR UPDATE`
}
