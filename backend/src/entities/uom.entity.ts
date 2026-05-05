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

@Entity('uoms')
export class Uom {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    name: string;

    @Column()
    code: string;

    /**
     * count | mass | volume
     * Used to prevent nonsensical conversions (e.g., g -> ml) unless explicitly allowed later.
     */
    @Column({ default: 'count' })
    kind: string;

    @Column({ type: 'int', nullable: true })
    baseUomId: number | null;

    /** Convert this UOM to base: qty_in_base = qty * multiplierToBase */
    @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
    multiplierToBase: number | null;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Uom, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'base_uom_id' })
    baseUom: Uom | null;
}
