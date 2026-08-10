import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { Order } from '../entities/order.entity';

// Statuses at or past payment-acceptance — the paid->accepted flip must never move
// an order backwards into 'accepted' from one of these.
const AT_OR_PAST_ACCEPTED = [
    'accepted',
    'preparing',
    'ready',
    'completed',
    'cancelled',
];

/** Money maths in integer paisa so 2-dp comparisons can never miss on float dust. */
const toPaisa = (n: number) => Math.round(n * 100);

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        private dataSource: DataSource,
    ) {}

    async processPayment(
        orderId: number,
        paymentMethod: string,
        amount: number,
        referenceNumber?: string,
        idempotencyKey?: string | null,
    ) {
        if (!Number.isFinite(amount) || amount < 0) {
            throw new BadRequestException('Payment amount must be >= 0');
        }
        return this.dataSource.transaction(async (manager) => {
            // Lock the order row: serializes concurrent tenders for this order so
            // split payments each see the other's committed row (the paid->accepted
            // flip is never missed) and a double-submit is serialized.
            const orderRows: Array<{
                id: number;
                status: string;
                total_amount: string;
            }> = await manager.query(
                `SELECT id, status, total_amount FROM orders WHERE id = $1 FOR UPDATE`,
                [orderId],
            );
            if (!orderRows.length)
                throw new NotFoundException('Order not found');
            const order = orderRows[0];

            // Idempotent tender: a retried / double-submitted payment carrying the
            // same key returns the original instead of recording a second payment.
            if (idempotencyKey) {
                const existing = await manager
                    .getRepository(Payment)
                    .findOne({ where: { orderId, idempotencyKey } });
                if (existing) return existing;
            }

            const paidRows: Array<{ total: string }> = await manager.query(
                `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = $1`,
                [orderId],
            );
            const totalDueP = toPaisa(Number(order.total_amount));
            const alreadyPaidP = toPaisa(Number(paidRows[0]?.total ?? 0));

            // A tender is a settlement of the bill, never more than it: the POS can
            // submit an amount priced from a quote that went stale in the same
            // moment the order was re-priced (a checkout-page discount landing with
            // the placement), and recording that gross figure is what inflated
            // payment reports past the money that actually changed hands. Clamp to
            // the outstanding balance instead of rejecting so the order still
            // advances (there is no re-pay UI to recover a refused tender).
            const outstandingP = Math.max(totalDueP - alreadyPaidP, 0);
            const appliedP = Math.min(toPaisa(amount), outstandingP);
            if (appliedP < toPaisa(amount)) {
                this.logger.warn(
                    `Tender clamped for order ${orderId}: sent ${amount}, ` +
                        `outstanding ${(outstandingP / 100).toFixed(2)} ` +
                        `(total ${order.total_amount}, already paid ${(alreadyPaidP / 100).toFixed(2)})`,
                );
            }

            // Fully paid already (and the order isn't a zero-total comp): recording
            // another row would only add noise — behave as an idempotent no-op.
            if (appliedP <= 0 && totalDueP > 0) {
                const latest = await manager.getRepository(Payment).findOne({
                    where: { orderId },
                    order: { id: 'DESC' },
                });
                if (latest) return latest;
            }

            const payment = await manager.getRepository(Payment).save(
                manager.getRepository(Payment).create({
                    orderId,
                    paymentMethod,
                    amount: appliedP / 100,
                    referenceNumber: referenceNumber ?? null,
                    idempotencyKey: idempotencyKey ?? null,
                    status: 'completed',
                    processedAt: new Date(),
                }),
            );

            if (alreadyPaidP + appliedP >= totalDueP) {
                // Advance to 'accepted' only from a pre-acceptance state — a scoped,
                // guarded UPDATE that never regresses a further order state.
                await manager.query(
                    `UPDATE orders SET status = 'accepted', updated_at = now()
                     WHERE id = $1 AND status <> ALL($2::text[])`,
                    [orderId, AT_OR_PAST_ACCEPTED],
                );
            }

            return payment;
        });
    }
}
