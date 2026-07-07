import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class PaymentsService {
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

            const payment = await manager.getRepository(Payment).save(
                manager.getRepository(Payment).create({
                    orderId,
                    paymentMethod,
                    amount,
                    referenceNumber: referenceNumber ?? null,
                    idempotencyKey: idempotencyKey ?? null,
                    status: 'completed',
                    processedAt: new Date(),
                }),
            );

            const totalRows: Array<{ total: string }> = await manager.query(
                `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = $1`,
                [orderId],
            );
            const totalPaid = Number(totalRows[0]?.total ?? 0);
            if (totalPaid >= Number(order.total_amount)) {
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
