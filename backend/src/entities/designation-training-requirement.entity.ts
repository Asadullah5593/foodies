import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Designation } from './designation.entity';
import { TrainingProgram } from './training-program.entity';

/**
 * "To be promoted into Head Chef you need Food Safety L2 and Fire Safety."
 *
 * Drives the readiness panel on the review form. Advisory: a missing training
 * WARNS and never blocks (decision #16). `requiredFor` distinguishes what is
 * needed to move INTO a role from what someone must keep current while holding
 * it — the latter is what expiry alerts chase.
 */
@Entity('designation_training_requirements')
@Unique(['designationId', 'programId', 'requiredFor'])
export class DesignationTrainingRequirement {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    designationId: number;

    @Column()
    programId: number;

    /** promotion_into | holding_role */
    @Column({ type: 'varchar', length: 24, default: 'promotion_into' })
    requiredFor: string;

    @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
    minScore: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Designation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'designation_id' })
    designation: Designation;

    @ManyToOne(() => TrainingProgram, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'program_id' })
    program: TrainingProgram;
}
