import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Uom } from './uom.entity';

@Entity('inventory_items')
export class InventoryItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    name: string;

    @Column()
    code: string;

    /** ingredient | packaging | finished */
    @Column({ default: 'ingredient' })
    type: string;

    @Column()
    baseUomId: number;

    @Column({ default: true })
    trackExpiry: boolean;

    @Column({ default: true })
    trackLot: boolean;

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
    defaultReorderPoint: number | null;

    @Column({ type: 'int', nullable: true })
    defaultNearExpiryDays: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'base_uom_id' })
    baseUom: Uom;
}

