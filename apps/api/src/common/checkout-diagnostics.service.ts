import { Inject, Injectable } from '@nestjs/common'
import type { OnApplicationBootstrap } from '@nestjs/common'
import { PRINCIPAL_RESOLVER } from '../auth/principal-resolver.js'
import type { PrincipalResolver } from '../auth/principal-resolver.js'
import { CartService } from '../cart/cart.service.js'
import { CheckoutService } from '../orders/checkout.service.js'
import { OrderService } from '../orders/order.service.js'
import { PaymentService } from '../payment/payment.service.js'
import { PaymentProviderRegistry } from '../payment/payment-registry.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { observeMethod } from './checkout-diagnostics.js'

/** Installs inert wrappers once. Only an explicit diagnostic request collects data. */
@Injectable()
export class CheckoutDiagnosticsService implements OnApplicationBootstrap {
  constructor(
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
    private readonly order: OrderService,
    private readonly payment: PaymentService,
    private readonly providers: PaymentProviderRegistry,
    private readonly prisma: PrismaService,
    @Inject(PRINCIPAL_RESOLVER) private readonly principal: PrincipalResolver,
  ) {}

  onApplicationBootstrap(): void {
    observeMethod(this.principal, 'resolve', 'auth')
    observeMethod(this.prisma, '$transaction', 'transaction')
    for (const [service, prefix, methods] of [
      [this.cart, 'cart', ['add', 'get', 'account', 'linesOf']],
      [this.checkout, 'checkout', ['open', 'read', 'account', 'linesOf']],
      [this.order, 'order', ['create', 'account', 'markPaid']],
      [this.payment, 'payment', ['start', 'authorize', 'capture', 'account', 'get']],
    ] as const) {
      for (const method of methods) observeMethod(service, method, `${prefix}_${method}`)
    }
    for (const name of this.providers.registered()) {
      const provider = this.providers.resolve(name)
      observeMethod(provider, 'authorize', 'provider_authorize')
      observeMethod(provider, 'capture', 'provider_capture')
    }
  }
}
