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
 * Overtime rates, branch-specific AND role-specific as the client asked.
 *
 * Resolution, most specific wins: designation+branch → branch → designation →
 * tenant default. Same shape as branch_menu_items overriding menu_items.
 *
 * `requiresApproval` defaults true: minutes accrue as pending in
 * attendance_days and payroll pays only what a manager confirmed.
 */
@Entity('overtime_policies')
export class OvertimePolicy {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'int', nullable: true })
    branchId: number | null;

    @Column({ type: 'int', nullable: true })
    designationId: number | null;

    @Column({ default: true })
    isEnabled: boolean;

    @Column({ type: 'int', default: 30 })
    minMinutesToQualify: number;

    @Column({ type: 'int', default: 15 })
    roundingMinutes: number;

    /** multiplier_of_hourly | flat_per_hour */
    @Column({ type: 'varchar', length: 32, default: 'multiplier_of_hourly' })
    rateType: string;

    @Column({ type: 'decimal', precision: 8, scale: 2, default: 1 })
    rateValue: number;

    @Column({ type: 'decimal', precision: 8, scale: 2, default: 1 })
    weeklyOffMultiplier: number;

    @Column({ type: 'decimal', precision: 8, scale: 2, default: 1 })
    holidayMultiplier: number;

    @Column({ type: 'int', nullable: true, default: 240 })
    dailyCapMinutes: number | null;

    @Column({ type: 'int', nullable: true })
    monthlyCapMinutes: number | null;

    @Column({ default: true })
    requiresApproval: boolean;

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
