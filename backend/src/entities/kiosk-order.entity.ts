import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    Index,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

/** One cart line as submitted by the kiosk (mirrors the createOrder item shape). */
export interface KioskOrderItemPayload {
    menu_item_id?: number;
    deal_menu_item_id?: number;
    quantity: number;
    variant_id?: number;
    addons?: { addon_id: number; quantity?: number }[];
    modifiers?: { modifier_id: number; quantity?: number }[];
    notes?: string;
    branch_id?: number;
    components?: Array<{
        slot_index: number;
        menu_item_id: number;
        quantity: number;
        variant_id?: number;
        addons?: { addon_id: number; quantity?: number }[];
        modifiers?: { modifier_id: number; quantity?: number }[];
        notes?: string;
    }>;
}

/** The raw createOrder DTO captured at kiosk-submit time. Replayed (or edited) at finalize. */
export interface KioskOrderPayload {
    branch_id: number;
    order_type: string;
    table_number?: string;
    customer_name?: string;
    customer_phone?: string;
    delivery_address?: string;
    items: KioskOrderItemPayload[];
    notes?: string;
    discount_code?: string;
    /**
     * The bank card the customer is paying with, chosen by the cashier at
     * finalize — never at kiosk-submit time, where the tender is still unknown.
     * The tender split itself is derived from the collected payments, not sent.
     */
    bank_card_id?: number | null;
}

export type KioskOrderStatus =
    | 'pending'
    | 'finalized'
    | 'cancelled'
    | 'expired';

/**
 * Holds a "pay at counter" cart submitted from the kiosk until a cashier
 * finalizes it. Intentionally a SEPARATE table from `orders` so it is invisible
 * to the orders module / KDS / reports until finalize creates the real Order.
 */
@Entity('kiosk_orders')
@Index('idx_kiosk_branch_status', ['branchId', 'status'])
export class KioskOrder {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    /** Brand of the cart (kiosk carts are single-brand; null only on legacy rows). */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    /** Short human-readable code the customer reads at the counter (e.g. "001"). */
    @Column({ type: 'varchar', length: 8 })
    kioskCode: string;

    /** Business day this code belongs to (YYYY-MM-DD) — codes reset/reuse per day. */
    @Column({ type: 'date' })
    codeDate: string;

    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status: KioskOrderStatus;

    @Column({ type: 'varchar' })
    orderType: string;

    /** The full createOrder DTO captured at submit time. */
    @Column({ type: 'jsonb' })
    payload: KioskOrderPayload;

    /** The quote() result at submit time (for display + price-change detection). */
    @Column({ type: 'jsonb', nullable: true })
    quoteSnapshot: Record<string, unknown> | null;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    snapshotTotal: number;

    @Column({ type: 'varchar', nullable: true })
    customerName: string | null;

    @Column({ type: 'varchar', nullable: true })
    customerPhone: string | null;

    /** Optional client-supplied key to make submit idempotent across retries. */
    @Column({ type: 'varchar', nullable: true })
    idempotencyKey: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    finalizedOrderGroupId: string | null;

    @Column({ type: 'int', nullable: true })
    finalizedByUserId: number | null;

    @Column({ type: 'timestamp', nullable: true })
    finalizedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    expiresAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
