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
import { Branch } from './branch.entity';
import { Designation } from './designation.entity';

/**
 * The client's monthly-off entitlement (docs/HRM.md §8, decision #10).
 *
 * Defaults encode the agreed policy: 4 per month, paid, no carry-forward,
 * unused offs ENCASHED at the daily rate, days beyond quota unpaid.
 *
 * ⚠️ Paid + non-carrying + encashed is intentional, not an oversight: an
 * employee who never takes a day off earns four extra days' pay per month, and
 * payroll must budget for it. Do not "fix" this.
 *
 * Resolution, most specific wins: designation+branch → branch → designation →
 * tenant default — the same shape as overtime and deduction rules.
 */
@Entity('holiday_policies')
export class HolidayPolicy {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'int', nullable: true })
    designationId: number | null;

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 4 })
    offsPerMonth: number;

    @Column({ default: true })
    offsArePaid: boolean;

    @Column({ default: false })
    carryForward: boolean;

    @Column({ default: true })
    encashUnused: boolean;

    /** floating | fixed_weekday */
    @Column({ type: 'varchar', length: 24, default: 'floating' })
    offSelection: string;

    /** unpaid_leave | absent */
    @Column({ type: 'varchar', length: 24, default: 'unpaid_leave' })
    beyondQuotaTreatment: string;

    @Column({ type: 'date', nullable: true })
    effectiveFrom: string | null;

    @Column({ type: 'date', nullable: true })
    effectiveTo: string | null;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch | null;

    @ManyToOne(() => Designation, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'designation_id' })
    designation: Designation | null;
}
