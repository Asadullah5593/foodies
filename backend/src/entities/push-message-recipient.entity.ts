import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export type PushRecipientStatus =
    | 'pending'
    | 'sending'
    | 'sent'
    | 'failed'
    | 'unknown'
    | 'holdout'
    | 'cancelled';

/**
 * One customer in one send. Written as `pending` before anything goes out,
 * flipped to `sending` just before its batch and to `sent` / `failed` after,
 * so a send interrupted mid-batch marks that batch `unknown` instead of
 * sending it again. `holdout` rows were deliberately not sent (the comparison
 * group); `cancelled` rows were still waiting when the message was cancelled.
 * Caps, "once ever", the customer's history and the orders-after-sending
 * results all read this table.
 */
@Entity('push_message_recipients')
export class PushMessageRecipient {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: string;

    @Column({ name: 'run_id' })
    runId: number;

    @Column({ name: 'message_id' })
    messageId: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    @Column({ name: 'customer_id' })
    customerId: number;

    /** 'A' or 'B' in an A/B test, else null. */
    @Column({ type: 'varchar', length: 1, nullable: true })
    variant: 'A' | 'B' | null;

    @Column({ length: 10, default: 'pending' })
    status: PushRecipientStatus;

    @Column({ type: 'int', default: 0 })
    phones: number;

    @Column({ type: 'int', default: 0 })
    sent: number;

    @Column({ type: 'int', default: 0 })
    failed: number;

    @Column({ type: 'varchar', nullable: true })
    error: string | null;

    @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
    sentAt: Date | null;
}
