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
import { TrainingProgram } from './training-program.entity';
import { User } from './user.entity';

/**
 * One employee's record against one program.
 *
 * `expiresOn` is computed from the program's validity at completion, not read
 * live — a program whose validity is later shortened must not retroactively
 * expire certificates people already hold.
 */
@Entity('employee_trainings')
@Unique(['employeeId', 'programId'])
export class EmployeeTraining {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column()
    programId: number;

    /** assigned | in_progress | completed | failed | expired */
    @Column({ type: 'varchar', length: 16, default: 'assigned' })
    status: string;

    @Column({ type: 'date', nullable: true })
    assignedOn: string | null;

    @Column({ type: 'date', nullable: true })
    startedOn: string | null;

    @Column({ type: 'date', nullable: true })
    completedOn: string | null;

    @Column({ type: 'date', nullable: true })
    expiresOn: string | null;

    @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
    score: number | null;

    @Column({ type: 'text', nullable: true })
    certificateUrl: string | null;

    @Column({ type: 'int', nullable: true })
    verifiedBy: number | null;

    @Column({ type: 'text', nullable: true })
    note: string | null;

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

    @ManyToOne(() => TrainingProgram, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'program_id' })
    program: TrainingProgram;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'verified_by' })
    verifier: User | null;
}
