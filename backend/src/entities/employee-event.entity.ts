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
 * The unified employment timeline — append-only.
 *
 * Every HR module writes here: hiring, confirmation, promotion, transfer,
 * salary change, training, review, warning, suspension, exit. It is the single
 * query behind the "complete history in one place" screen the client asked for,
 * instead of a nine-way UNION across the modules that produced the history.
 *
 * Rows are never edited or deleted. `refTable`/`refId` point back at whatever
 * caused the event so the timeline can deep-link, and `payload` snapshots the
 * human-readable detail (old → new designation, old → new salary) so the entry
 * still reads correctly after the source row changes.
 */
@Entity('employee_events')
export class EmployeeEvent {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column({ type: 'varchar', length: 48 })
    eventType: string;

    @Column({ type: 'date' })
    eventDate: string;

    @Column({ type: 'varchar', length: 200 })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    refTable: string | null;

    @Column({ type: 'int', nullable: true })
    refId: number | null;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    payload: Record<string, unknown>;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'employee_id' })
    employee: Employee;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;
}
