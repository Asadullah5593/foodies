import { Logger } from '@nestjs/common';
import {
    OrderStatusRef,
    OrderStatusResult,
    PaymentGatewayProvider,
    RegisterOrderParams,
    RegisterOrderResult,
} from './epg.types';

/**
 * Dev/no-op payment gateway. Selected when PAYMENT_PROVIDER != 'meezan' so the
 * app boots and the payment flow can be exercised locally without a real
 * gateway. It never contacts a bank:
 *  - registerOrder() returns a fake bankOrderId and points formUrl at the
 *    returnUrl (so a developer can click straight through), and
 *  - getOrderStatus() always reports Deposited (2), i.e. "paid".
 *
 * This mirrors the SMS service's console fallback (log-only when unconfigured).
 * Never enable this in production — PAYMENT_PROVIDER must be `meezan` there.
 */
export class ConsoleEpgProvider implements PaymentGatewayProvider {
    private readonly logger = new Logger('EpgConsole');

    registerOrder(params: RegisterOrderParams): Promise<RegisterOrderResult> {
        this.logger.warn(
            `[DEV] console gateway: register ${params.orderNumber} for PKR ${params.amountMajor} (no real gateway call)`,
        );
        const bankOrderId = `dev-${params.orderNumber}`;
        const sep = params.returnUrl.includes('?') ? '&' : '?';
        const formUrl = `${params.returnUrl}${sep}orderId=${encodeURIComponent(
            bankOrderId,
        )}&dev=1`;
        return Promise.resolve({ bankOrderId, formUrl });
    }

    getOrderStatus(ref: OrderStatusRef): Promise<OrderStatusResult> {
        this.logger.warn(
            `[DEV] console gateway: status for ${
                ref.bankOrderId ?? ref.orderNumber
            } -> Deposited(2)`,
        );
        return Promise.resolve({ orderStatus: 2, raw: { dev: true } });
    }
}
