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

/**
 * A kind of leave and the rules for earning it.
 *
 * The client's "4 holidays per month" is modelled here as a leave type
 * (`monthly_off`) rather than a separate mechanism, so one balance ledger and
 * one approval flow cover everything. What makes it distinctive is the
 * combination `isPaid + carryForward=false + encashUnused=true`
 * (docs/HRM.md §8).
 */
@Entity('leave_types')
export class LeaveType {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    @Column({ type: 'varchar', length: 48 })
    code: string;

    @Column({ default: true })
    isPaid: boolean;

    /** monthly | annual | none */
    @Column({ type: 'varchar', length: 16, default: 'monthly' })
    accrualMode: string;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    quotaPerPeriod: number;

    @Column({ default: false })
    carryForward: boolean;

    /** Unused entitlement is paid out — see monthlyOffPosition(). */
    @Column({ default: false })
    encashUnused: boolean;

    @Column({ type: 'int', nullable: true })
    maxConsecutiveDays: number | null;

    @Column({ default: false })
    requiresDocument: boolean;

    /**
     * Consumes the monthly-off entitlement rather than a separate allowance.
     * Exactly one type per tenant should carry this.
     */
    @Column({ default: false })
    isMonthlyOff: boolean;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;
}
