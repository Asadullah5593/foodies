import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';

/**
 * Eid, 14 August, and anything else the business closes for.
 *
 * Distinct from the 4 monthly offs and does NOT consume that quota — a public
 * holiday is the business not opening, an off is the employee not coming in.
 * Conflating them would quietly cost every employee a day of entitlement each
 * time a holiday falls.
 */
@Entity('public_holidays')
export class PublicHoliday {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    /** null = every branch. */
    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'date' })
    holidayDate: string;

    @Column({ type: 'varchar', length: 160 })
    name: string;

    @Column({ default: true })
    isPaid: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch | null;
}
