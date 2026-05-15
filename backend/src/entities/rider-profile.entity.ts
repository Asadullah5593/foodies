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
import { User } from './user.entity';

@Entity('rider_profiles')
export class RiderProfile {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    userId: number;

    @Column()
    tenantId: number;

    @Column({ type: 'varchar', length: 32, default: 'active' })
    employmentStatus: string;

    @Column({ type: 'varchar', length: 32, default: 'hybrid' })
    salaryType: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    employeeCode: string | null;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    baseSalary: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    defaultPerRideCommission: number;

    @Column({ type: 'int', default: 1 })
    maxActiveOrders: number;

    @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
    minRating: number | null;

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    minTimelyRate: number | null;

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    metadata: Record<string, unknown>;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;
}
