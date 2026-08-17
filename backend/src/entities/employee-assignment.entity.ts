import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Employee } from './employee.entity';
import { Branch } from './branch.entity';
import { Brand } from './brand.entity';
import { Designation } from './designation.entity';
import { User } from './user.entity';

/**
 * The employment-history spine.
 *
 * One row per period during which the employee held a given branch + brand +
 * designation. The CURRENT assignment is the row with `effectiveTo IS NULL`,
 * and a partial unique index guarantees there is exactly one.
 *
 * ⚠️ Never UPDATE a row to reflect a change. Close it (`effectiveTo`) and open
 * a new one. Every promotion, demotion, confirmation, branch transfer and brand
 * transfer is a new row, which is what makes "previous roles / current role /
 * transfers between branches / transfers between brands" a single query instead
 * of four bespoke audit tables.
 *
 * `brandId` is nullable on purpose: cleaners, security and porters belong to
 * the branch, not to a brand, and must stay visible to any manager on that
 * floor (docs/HRM.md §14.3).
 */
@Entity('employee_assignments')
export class EmployeeAssignment {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column()
    branchId: number;

    /** null = not tied to a brand (shared branch staff). */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    designationId: number;

    @Column({ type: 'varchar', length: 32, default: 'full_time' })
    employmentType: string;

    @Column({ type: 'date' })
    effectiveFrom: string;

    /** null = this is the current assignment. */
    @Column({ type: 'date', nullable: true })
    effectiveTo: string | null;

    /**
     * hire | confirmation | promotion | demotion | transfer_branch |
     * transfer_brand | designation_change | rehire | exit
     */
    @Column({ type: 'varchar', length: 32 })
    changeReason: string;

    /** Set when the change came out of an approved review. */
    @Column({ type: 'int', nullable: true })
    sourceReviewId: number | null;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Employee, (e) => e.assignments, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand | null;

    @ManyToOne(() => Designation, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'designation_id' })
    designation: Designation;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;
}
