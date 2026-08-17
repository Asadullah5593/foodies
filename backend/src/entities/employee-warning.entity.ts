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
import { User } from './user.entity';

/**
 * Disciplinary record — verbal warning, written warning, show-cause, final.
 *
 * Feeds the review form: a reviewer deciding on a promotion should see the
 * warnings alongside the scores, which is exactly the information that tends to
 * live in a manager's memory and vanish when they leave.
 */
@Entity('employee_warnings')
export class EmployeeWarning {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column({ type: 'varchar', length: 48 })
    warningType: string;

    @Column({ type: 'varchar', length: 16, default: 'low' })
    severity: string;

    @Column({ type: 'int', nullable: true })
    issuedBy: number | null;

    @Column({ type: 'date' })
    issuedOn: string;

    @Column({ type: 'text' })
    reason: string;

    @Column({ type: 'text', nullable: true })
    employeeResponse: string | null;

    @Column({ type: 'text', nullable: true })
    documentUrl: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'issued_by' })
    issuer: User | null;
}
