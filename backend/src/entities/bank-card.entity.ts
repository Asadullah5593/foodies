import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

/**
 * A specific bank card / product a tenant runs offers on (e.g. "HBL Premium Debit").
 * Tenant-scoped catalog. Card-linked discounts reference these by id. `binPrefixes` optionally
 * enables BIN auto-detect (first 6–8 digits of the card number) but manual selection is primary.
 */
@Entity('bank_cards')
export class BankCard {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /** Display name, e.g. "HBL Premium Debit". */
    @Column()
    name: string;

    /** Issuing bank, e.g. "HBL". */
    @Column({ type: 'varchar', nullable: true })
    bank: string | null;

    /** Network / product tag, e.g. "visa" | "mastercard" | "debit" | "credit" (display only). */
    @Column({ type: 'varchar', nullable: true })
    network: string | null;

    /** Optional BIN prefixes (6–8 digit) for auto-detect from the card number. */
    @Column({ name: 'bin_prefixes', type: 'simple-json', nullable: true })
    binPrefixes: string[] | null;

    @Column({ name: 'is_active', default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    tenant: Tenant;
}
