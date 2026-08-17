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
 * A configurable review form.
 *
 * The questions live in `schema` as JSON rather than as tables, so HR can change
 * the form without a migration — the same approach as invoice templates. Only
 * `rating` questions score; text and boolean answers are commentary.
 *
 * `appliesToCycleTypes` exists because a disciplinary review is not a quarterly
 * appraisal: the reviewer should get the right form automatically.
 */
@Entity('review_templates')
export class ReviewTemplate {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column({ type: 'varchar', length: 160 })
    name: string;

    /** probation_3m | quarterly | ad_hoc */
    @Column({ type: 'jsonb', default: () => `'["quarterly"]'` })
    appliesToCycleTypes: string[];

    /** { sections: [{ title, questions: [{ key, label, type, weight, max }] }] } */
    @Column({ type: 'jsonb', default: () => "'{}'" })
    schema: Record<string, unknown>;

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
