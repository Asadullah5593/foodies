import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { User } from './user.entity';
import { RiderPayrollLine } from './rider-payroll-line.entity';

@Entity('rider_payroll_runs')
export class RiderPayrollRun {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ nullable: true })
    branchId: number | null;

    @Column({ type: 'date' })
    periodFrom: string;

    @Column({ type: 'date' })
    periodTo: string;

    @Column({ type: 'varchar', length: 32, default: 'draft' })
    status: string;

    @Column({ type: 'varchar', length: 80, nullable: true })
    ruleVersion: string | null;

    @Column({ nullable: true })
    requestedBy: number | null;

    @Column({ nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    finalizedAt: Date | null;

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

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'requested_by' })
    requester: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'approved_by' })
    approver: User | null;

    @OneToMany(() => RiderPayrollLine, (line) => line.run, { cascade: true })
    lines: RiderPayrollLine[];
}
