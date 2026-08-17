import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Employee } from './employee.entity';
import { Branch } from './branch.entity';
import { WorkScheduleTemplate } from './work-schedule-template.entity';

/**
 * The published roster: an explicit template for one employee on one date.
 *
 * Built now, largely unused at launch — every employee works fixed timings, so
 * the live path is the employee's default template. It exists so that adding
 * rotation later is a data change, not a change to the attendance engine
 * (docs/HRM.md §5.1).
 */
@Entity('employee_schedules')
@Unique(['employeeId', 'workDate'])
export class EmployeeSchedule {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column()
    branchId: number;

    @Column({ type: 'date' })
    workDate: string;

    @Column({ type: 'int', nullable: true })
    templateId: number | null;

    @Column({ default: false })
    isWeeklyOff: boolean;

    @Column({ default: false })
    isHoliday: boolean;

    @Column({ default: true })
    isPublished: boolean;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => WorkScheduleTemplate, {
        onDelete: 'SET NULL',
        nullable: true,
    })
    @JoinColumn({ name: 'template_id' })
    template: WorkScheduleTemplate | null;
}
