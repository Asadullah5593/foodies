import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt, randomUUID } from 'crypto';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { Branch } from '../entities/branch.entity';
import {
    EpgPaymentSession,
    EpgSessionStatus,
} from './epg-payment-session.entity';
import { EpgError, EpgOrderStatus, PAYMENT_GATEWAY } from './epg.types';
import type { PaymentGatewayProvider } from './epg.types';

/** Mirror the bank's fixed 20-minute order lifetime. */
const SESSION_TTL_MS = 20 * 60 * 1000;

const RETURN_URL =
    process.env.MEEZAN_EPG_RETURN_URL ||
    'https://app.foodies-pakistan.com/pay/return';

export interface CreateSessionInput {
    /** Validated createOrder cart from the controller (payment_split/bank_card_id stripped). */
    cart: Record<string, unknown>;
    /** Authenticated customer id (null for a guest identified by phone). */
    customerId: number | null;
}

export interface SessionView {
    session_id: string; // publicToken — never the serial id
    status: EpgSessionStatus;
    /** Amount that will be charged, in PKR (major units) — for the app to display. */
    amount: number;
    /** ISO 4217 numeric currency (PKR = "586"). */
    currency: string;
    form_url: string | null;
    expires_at: string;
    order_group_id: string | null;
}

/**
 * Orchestrates online-card payments (Meezan EPG, one-phase, create-on-confirm).
 *
 * createSession: price the cart as CARD tender, register with the bank, and
 * hold the cart in a pending session — NO order exists yet.
 * pollAndConfirm: on bank status 2 (Deposited), materialise the order via the
 * existing OrdersService.createOrder and record the card tender. Everything is
 * idempotent so a poll + redirect + retry racing to confirm can never create a
 * second order or double-charge.
 */
@Injectable()
export class EpgService {
    private readonly logger = new Logger(EpgService.name);

    constructor(
        @Inject(PAYMENT_GATEWAY)
        private readonly gateway: PaymentGatewayProvider,
        @InjectRepository(EpgPaymentSession)
        private readonly sessionRepo: Repository<EpgPaymentSession>,
        @InjectRepository(Branch)
        private readonly branchRepo: Repository<Branch>,
        private readonly ordersService: OrdersService,
        private readonly paymentsService: PaymentsService,
    ) {}

    // --- session creation -------------------------------------------------

    async createSession(input: CreateSessionInput): Promise<SessionView> {
        const cart = { ...input.cart };
        const branchId = Number(cart.branch_id);
        if (!Number.isInteger(branchId)) {
            throw new BadRequestException('branch_id is required');
        }
        if (!Array.isArray(cart.items) || cart.items.length === 0) {
            throw new BadRequestException('items is required');
        }
        // Tender is decided server-side. Strip anything the client sent so it
        // can't force the cash GST rate or inject a card-linked discount.
        delete cart.payment_split;
        delete cart.bank_card_id;

        const tenantId = await this.resolveTenantId(branchId);

        // Price as FULL CARD tender. Per computeTenderTax, cash=0 && card>0 gives
        // the card GST rate regardless of the card amount's magnitude, so a
        // sentinel of 1 yields the correct card-priced total.
        const quoteDto = {
            ...cart,
            payment_split: { cash_amount: 0, card_amount: 1 },
        };
        const quote = await this.ordersService.quote(
            quoteDto as Parameters<OrdersService['quote']>[0],
            tenantId,
            'consumer_app',
        );
        const totalMajor = Number(
            (quote as { total_amount?: number }).total_amount,
        );
        if (!Number.isFinite(totalMajor) || totalMajor <= 0) {
            throw new BadRequestException(
                'Order total must be greater than zero for online payment',
            );
        }
        const amountMinor = Math.round(totalMajor * 100);

        // The cart we REPLAY on confirmation carries the honest card total, so
        // createOrder reprices to the same figure we charged.
        const storedCart = {
            ...cart,
            payment_split: { cash_amount: 0, card_amount: totalMajor },
        };

        const orderNumber = this.generateOrderNumber();

        // Register with the bank first; nothing is persisted if it fails.
        let reg;
        try {
            reg = await this.gateway.registerOrder({
                orderNumber,
                amountMajor: totalMajor,
                returnUrl: RETURN_URL,
                description: `Foodies order (branch ${branchId})`,
            });
        } catch (e) {
            const msg = e instanceof EpgError ? e.message : String(e);
            this.logger.error(
                `register.do failed for orderNumber ${orderNumber}: ${msg}`,
            );
            throw new ServiceUnavailableException(
                'Unable to start the payment. Please try again.',
            );
        }

        const customerPhone =
            typeof cart.customer_phone === 'string'
                ? cart.customer_phone
                : null;

        const session = await this.sessionRepo.save(
            this.sessionRepo.create({
                publicToken: randomUUID(),
                tenantId,
                branchId,
                status: 'pending',
                orderNumber,
                bankOrderId: reg.bankOrderId,
                formUrl: reg.formUrl,
                amountMinor,
                currency: '586',
                cart: storedCart,
                customerId: input.customerId,
                customerPhone,
                // Idempotency key for createOrder on confirmation — stable per
                // session so a double-confirm returns the same order group.
                idempotencyKey: `epg:${orderNumber}`,
                expiresAt: new Date(Date.now() + SESSION_TTL_MS),
            }),
        );
        this.logger.log(
            `EPG session ${session.id} created (orderNumber ${orderNumber}, PKR ${totalMajor})`,
        );
        return this.toView(session);
    }

    // --- status + confirmation -------------------------------------------

    /**
     * Return the app-facing view. If still pending, poll the bank on demand so
     * the customer returning from the payment page gets a prompt result rather
     * than waiting for the cron sweep.
     */
    async getSessionView(publicToken: string): Promise<SessionView | null> {
        const session = await this.sessionRepo.findOne({
            where: { publicToken },
        });
        if (!session) return null;
        const fresh =
            session.status === 'pending'
                ? await this.pollAndConfirm(session)
                : session;
        return this.toView(fresh);
    }

    /** Poller entry point: confirm/expire every pending session. */
    async sweepPending(limit = 200): Promise<{ processed: number }> {
        const pending = await this.sessionRepo.find({
            where: { status: 'pending' },
            order: { id: 'ASC' },
            take: limit,
        });
        let processed = 0;
        for (const s of pending) {
            try {
                await this.pollAndConfirm(s);
                processed += 1;
            } catch (e) {
                this.logger.error(
                    `sweep failed for session ${s.id}: ${
                        e instanceof Error ? e.message : String(e)
                    }`,
                );
            }
        }
        return { processed };
    }

    /**
     * Poll the bank for one pending session and advance its state.
     * Terminal states (paid/failed/expired/error) are returned untouched.
     */
    async pollAndConfirm(
        session: EpgPaymentSession,
    ): Promise<EpgPaymentSession> {
        if (session.status !== 'pending') return session;

        let status;
        try {
            status = await this.gateway.getOrderStatus({
                bankOrderId: session.bankOrderId ?? undefined,
                orderNumber: session.orderNumber,
            });
        } catch (e) {
            // Bank unreachable — NEVER expire here; the customer may have paid.
            // Leave pending and retry on the next sweep.
            this.logger.warn(
                `status poll failed for session ${session.id} (${
                    session.orderNumber
                }): ${e instanceof Error ? e.message : String(e)}`,
            );
            await this.sessionRepo.update(session.id, {
                lastPolledAt: new Date(),
            });
            return session;
        }

        const patch: Partial<EpgPaymentSession> = {
            lastPolledAt: new Date(),
            bankOrderStatus:
                typeof status.orderStatus === 'number'
                    ? status.orderStatus
                    : null,
            rawStatus: status.raw,
        };
        // Every value the bank returns (0/1/2/3/4/6) is an EpgOrderStatus
        // member; an unexpected number simply matches no case below.
        const os = status.orderStatus as EpgOrderStatus;

        if (os === EpgOrderStatus.Deposited) {
            return this.confirmPaid(session, patch);
        }

        if (
            os === EpgOrderStatus.Declined ||
            os === EpgOrderStatus.Reversed ||
            os === EpgOrderStatus.Refunded
        ) {
            patch.status = 'failed';
            patch.failureReason = `bank orderStatus ${os}`;
            return this.applyPatch(session, patch);
        }

        // 0 (registered/unpaid) or 1 (approved, transient). Keep waiting unless
        // the window has elapsed.
        if (Date.now() > new Date(session.expiresAt).getTime()) {
            if (os === EpgOrderStatus.Approved) {
                // Approved but never deposited past expiry is anomalous — flag
                // for manual review rather than silently expiring a possibly
                // charged authorisation.
                patch.status = 'error';
                patch.failureReason =
                    'expired while bank status was Approved(1) — needs manual review';
                this.logger.error(
                    `EPG session ${session.id} (${session.orderNumber}) expired at status 1 — MANUAL REVIEW`,
                );
            } else {
                patch.status = 'expired';
                patch.failureReason = 'payment window elapsed with no payment';
            }
        }
        return this.applyPatch(session, patch);
    }

    /**
     * Bank confirmed payment (status 2). Materialise the real order and record
     * the card tender. Idempotent throughout:
     *  - createOrder dedupes on session.idempotencyKey (same group on retry).
     *  - processPayment dedupes on (order_id, key).
     * If createOrder throws AFTER payment was captured, we flag `error` and
     * shout — the money is real and must be refunded/reconciled by ops.
     */
    private async confirmPaid(
        session: EpgPaymentSession,
        patch: Partial<EpgPaymentSession>,
    ): Promise<EpgPaymentSession> {
        let group: { order_group_id: string; orders: Array<unknown> };
        try {
            group = (await this.ordersService.createOrder(
                session.cart as Parameters<OrdersService['createOrder']>[0],
                session.tenantId,
                null, // createdBy
                'consumer_app', // online card is app-only
                session.customerId, // loggedInCustomerId
                null, // allowedBrandIds
                session.idempotencyKey,
            )) as { order_group_id: string; orders: Array<unknown> };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(
                `PAID-BUT-ORDER-FAILED session ${session.id} (${session.orderNumber}): ${msg} — REFUND + OPS REQUIRED`,
            );
            patch.status = 'error';
            patch.failureReason = `paid but order creation failed: ${msg}`;
            return this.applyPatch(session, patch);
        }

        const orders = (group.orders ?? []) as Array<{
            id: number;
            total_amount: number | string;
        }>;
        const chargedMajor = Number(session.amountMinor) / 100;
        let orderedMajor = 0;
        let recordingFailed = false;

        for (const o of orders) {
            const amount = Number(o.total_amount);
            orderedMajor += amount;
            try {
                await this.paymentsService.processPayment(
                    o.id,
                    'card',
                    amount,
                    session.bankOrderId ?? undefined,
                    `epg:${session.orderNumber}:${o.id}`,
                );
            } catch (e) {
                recordingFailed = true;
                this.logger.error(
                    `processPayment failed for order ${o.id} on session ${session.id}: ${
                        e instanceof Error ? e.message : String(e)
                    }`,
                );
            }
        }

        // Price-lock: what we charged vs what the order re-priced to. A mismatch
        // means the menu changed inside the 20-min window — rare, non-blocking,
        // but must be surfaced (we captured `chargedMajor`, the order owes
        // `orderedMajor`).
        const priceMismatch = Math.abs(orderedMajor - chargedMajor) > 0.01;
        if (priceMismatch) {
            this.logger.error(
                `PRICE MISMATCH session ${session.id} (${session.orderNumber}): charged ${chargedMajor} but order total ${orderedMajor} — REVIEW`,
            );
        }

        patch.createdOrderGroupId = group.order_group_id;
        if (recordingFailed) {
            patch.status = 'error';
            patch.failureReason =
                'payment recording failed for one or more orders';
        } else if (priceMismatch) {
            patch.status = 'error';
            patch.failureReason = `price mismatch: charged ${chargedMajor}, order ${orderedMajor}`;
        } else {
            patch.status = 'paid';
        }
        this.logger.log(
            `EPG session ${session.id} confirmed -> ${patch.status} (order group ${group.order_group_id})`,
        );
        return this.applyPatch(session, patch);
    }

    // --- helpers ----------------------------------------------------------

    private async applyPatch(
        session: EpgPaymentSession,
        patch: Partial<EpgPaymentSession>,
    ): Promise<EpgPaymentSession> {
        await this.sessionRepo.update(
            session.id,
            patch as Parameters<Repository<EpgPaymentSession>['update']>[1],
        );
        return { ...session, ...patch } as EpgPaymentSession;
    }

    private async resolveTenantId(branchId: number): Promise<number> {
        const branch = (await this.branchRepo.findOne({
            where: { id: branchId },
            relations: ['branchBrands', 'branchBrands.brand'],
        })) as {
            branchBrands?: Array<{ brand?: { tenantId?: number } }>;
        } | null;
        const tid = branch?.branchBrands?.[0]?.brand?.tenantId ?? null;
        if (tid == null) throw new NotFoundException('Branch not found');
        return tid;
    }

    /** Hyphen-free alphanumeric (spec type AN) bank reference, `FDS` + 13 chars. */
    private generateOrderNumber(): string {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 13; i++)
            code += alphabet[randomInt(alphabet.length)];
        return `FDS${code}`;
    }

    private toView(s: EpgPaymentSession): SessionView {
        return {
            session_id: s.publicToken,
            status: s.status,
            // amountMinor is a bigint column (returned as a string by pg).
            amount: Number(s.amountMinor) / 100,
            currency: s.currency,
            form_url: s.formUrl,
            expires_at: new Date(s.expiresAt).toISOString(),
            order_group_id: s.createdOrderGroupId,
        };
    }
}
