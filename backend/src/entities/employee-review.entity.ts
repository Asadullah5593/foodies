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
import { Employee } from './employee.entity';
import { ReviewCycle } from './review-cycle.entity';
import { Designation } from './designation.entity';
import { User } from './user.entity';

/**
 * A completed review and its decision.
 *
 * `templateSnapshot` is stored alongside the answers because the form will
 * change: without it, a two-year-old review renders against today's questions
 * and stops meaning what it said.
 *
 * On approval with `outcome = promoted`, one transaction writes a new
 * `employee_assignments` row, a new `employee_salary_structures` row and the
 * matching `employee_events` — which is what makes a promotion a state change
 * with a paper trail rather than a note in a text field (docs/HRM.md §13.3).
 */
@Entity('employee_reviews')
export class EmployeeReview {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    cycleId: number;

    @Column()
    employeeId: number;

    @Column({ type: 'int', nullable: true })
    reviewerUserId: number | null;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    templateSnapshot: Record<string, unknown>;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    answers: Record<string, unknown>;

    @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
    totalScore: number;

    @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
    maxScore: number;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    normalizedPercent: number | null;

    @Column({ type: 'text', nullable: true })
    strengths: string | null;

    @Column({ type: 'text', nullable: true })
    improvements: string | null;

    @Column({ type: 'text', nullable: true })
    reviewerComments: string | null;

    /** The employee's own response, if they were shown the review. */
    @Column({ type: 'text', nullable: true })
    employeeComments: string | null;

    @Column({ type: 'timestamp', nullable: true })
    acknowledgedAt: Date | null;

    /** promoted | no_promotion | increment_only | pip | terminate */
    @Column({ type: 'varchar', length: 24, nullable: true })
    outcome: string | null;

    @Column({ type: 'int', nullable: true })
    promotedToDesignationId: number | null;

    @Column({
        type: 'decimal',
        precision: 12,
        scale: 2,
        nullable: true,
    })
    newBasicAmount: number | null;

    @Column({ type: 'date', nullable: true })
    effectiveFrom: string | null;

    /**
     * Training the employee lacked for the target designation, snapshotted at
     * submission. Advisory — a gap warns, it never blocks (decision #16).
     */
    @Column({ type: 'jsonb', default: () => "'[]'" })
    trainingGaps: Record<string, unknown>[];

    /** draft | submitted | approved */
    @Column({ type: 'varchar', length: 16, default: 'draft' })
    status: string;

    @Column({ type: 'timestamp', nullable: true })
    submittedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    approvedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    approvedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => ReviewCycle, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'cycle_id' })
    cycle: ReviewCycle;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => Designation, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'promoted_to_designation_id' })
    promotedToDesignation: Designation | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'reviewer_user_id' })
    reviewer: User | null;
}
