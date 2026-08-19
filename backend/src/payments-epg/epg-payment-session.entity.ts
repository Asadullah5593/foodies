import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

/**
 * A single online-card payment attempt (create-on-confirm architecture).
 *
 * The customer's order does NOT exist while a session is pending — the cart is
 * held here. Only when the bank confirms payment (orderStatus 2) do we call the
 * existing OrdersService.createOrder(cart) to materialise the real order, then
 * record the card tender. A retry (failed/expired) is a brand-new session row
 * with its own unique bank `orderNumber`.
 */
export type EpgSessionStatus =
    | 'pending' // registered with the bank, awaiting payment
    | 'paid' // confirmed; order created + payment recorded
    | 'failed' // bank declined the payment
    | 'expired' // 20-min window elapsed with no payment
    | 'error'; // paid, but order creation failed (needs ops/refund)

@Entity('epg_payment_sessions')
@Index(['status', 'expiresAt']) // poller sweeps pending sessions by (status, expiry)
export class EpgPaymentSession {
    @PrimaryGeneratedColumn()
    id: number;

    /**
     * Unguessable external handle used by the app-facing status endpoint. The
     * serial `id` is enumerable, so we never expose it — the app only ever sees
     * this token (prevents reading another customer's session/order = IDOR).
     */
    @Column({ unique: true })
    publicToken: string;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column({ default: 'pending' })
    status: EpgSessionStatus;

    /**
     * The `orderNumber` sent to the bank. Globally unique per merchant forever
     * (a used one is burned). Hyphen-free alphanumeric (spec: type AN). This is
     * a SESSION reference — the order (and its FDS order_id) does not exist yet.
     */
    @Column({ unique: true })
    orderNumber: string;

    /** The bank's order id (mdOrder), returned by register.do. */
    @Column({ type: 'varchar', nullable: true })
    bankOrderId: string | null;

    /** Hosted payment page URL the app opens in a WebView. */
    @Column({ type: 'text', nullable: true })
    formUrl: string | null;

    /** Amount registered with the bank, in MINOR units (paisa). Source of truth. */
    @Column({ type: 'bigint' })
    amountMinor: number;

    /** ISO 4217 numeric currency; PKR = 586. */
    @Column({ type: 'varchar', length: 3, default: '586' })
    currency: string;

    /**
     * The createOrder DTO (cart + options) to replay on confirmation, priced as
     * CARD tender (payment_split.card_amount set) so the confirmed order's GST
     * matches what we charged.
     */
    @Column({ type: 'jsonb' })
    cart: Record<string, unknown>;

    @Column({ type: 'int', nullable: true })
    customerId: number | null;

    @Column({ type: 'varchar', nullable: true })
    customerPhone: string | null;

    /**
     * Idempotency key handed to createOrder on confirmation so a double-confirm
     * (poll + redirect racing) can never create two orders.
     */
    @Column({ type: 'varchar' })
    idempotencyKey: string;

    /** order_group_id of the order created once this session was paid. */
    @Column({ type: 'varchar', nullable: true })
    createdOrderGroupId: string | null;

    /** Last orderStatus value seen from getOrderStatusExtended (0/1/2/6). */
    @Column({ type: 'smallint', nullable: true })
    bankOrderStatus: number | null;

    @Column({ type: 'timestamp', nullable: true })
    lastPolledAt: Date | null;

    /** created + 20 min — mirrors the bank's fixed order lifetime. */
    @Column({ type: 'timestamp' })
    expiresAt: Date;

    /** Last raw getOrderStatusExtended response, kept for audit/reconciliation. */
    @Column({ type: 'jsonb', nullable: true })
    rawStatus: Record<string, unknown> | null;

    /** Human-readable reason when status is failed/expired/error. */
    @Column({ type: 'varchar', nullable: true })
    failureReason: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
