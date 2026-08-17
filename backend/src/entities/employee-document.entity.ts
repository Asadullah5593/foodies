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
import { User } from './user.entity';

/**
 * Employee paperwork: CNIC copy, contract, certificates, medical fitness.
 *
 * `expiresOn` is the point of the table as much as storage is — a lapsed
 * food-handler certificate is an operational and regulatory problem, so expiry
 * drives notifications rather than sitting in a folder nobody opens.
 */
@Entity('employee_documents')
export class EmployeeDocument {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    employeeId: number;

    @Column({ type: 'varchar', length: 48 })
    docType: string;

    @Column({ type: 'text' })
    fileUrl: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    documentNumber: string | null;

    @Column({ type: 'date', nullable: true })
    issuedOn: string | null;

    @Column({ type: 'date', nullable: true })
    expiresOn: string | null;

    @Column({ type: 'int', nullable: true })
    verifiedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    verifiedAt: Date | null;

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

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'verified_by' })
    verifier: User | null;
}
