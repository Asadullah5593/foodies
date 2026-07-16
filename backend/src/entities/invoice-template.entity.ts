import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import type { InvoiceTemplateConfig } from '../invoices/invoice-template-config';

/**
 * A selectable invoice/receipt schema. Tenant-owned; an optional brandId scopes
 * it to one brand (null = tenant-wide default, applies to every brand). `layout`
 * picks the rendering skeleton (versioned in code); `config` holds the per-field
 * toggles. The active template resolves brand → tenant → built-in default.
 */
@Entity('invoice_templates')
export class InvoiceTemplate {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /** null = tenant-wide (all brands); else scoped to this brand. */
    @Column({ name: 'brand_id', type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    name: string;

    /** bill_bordered | receipt_logo | thermal_modern | thermal_classic | thermal_58mm | a4_invoice */
    @Column({ type: 'varchar', default: 'bill_bordered' })
    layout: string;

    @Column({ name: 'is_active', default: true })
    isActive: boolean;

    /** The customer-invoice default for its scope. */
    @Column({ name: 'is_default', default: false })
    isDefault: boolean;

    /** The kitchen-invoice (KOT) default for its scope; a template can be both. */
    @Column({ name: 'is_default_kitchen', default: false })
    isDefaultKitchen: boolean;

    /** Per-field toggles; merged over defaults on read. */
    @Column('simple-json', { nullable: true })
    config: Partial<InvoiceTemplateConfig> | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    tenant: Tenant;
}
