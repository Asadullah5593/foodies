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

/**
 * A course staff can be put through — food safety, fire safety, POS operation.
 *
 * `validityMonths` is what makes this more than a checklist: a lapsed
 * food-handler certificate is an operational and regulatory problem, so a
 * completed training can EXPIRE and stop counting toward a promotion.
 */
@Entity('training_programs')
export class TrainingProgram {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'varchar', length: 160 })
    name: string;

    @Column({ type: 'varchar', length: 48 })
    code: string;

    @Column({ type: 'varchar', length: 48, nullable: true })
    category: string | null;

    /** 1 = introductory, higher = more advanced. */
    @Column({ type: 'int', default: 1 })
    level: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    durationHours: number;

    /** null = never expires. */
    @Column({ type: 'int', nullable: true })
    validityMonths: number | null;

    @Column({ default: false })
    isMandatory: boolean;

    @Column({ type: 'jsonb', default: () => "'[]'" })
    prerequisiteProgramIds: number[];

    @Column({ type: 'jsonb', default: () => "'[]'" })
    materialUrls: Record<string, unknown>[];

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;
}
