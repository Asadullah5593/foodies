import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { RiderCompPlan } from './rider-comp-plan.entity';

@Entity('rider_comp_plan_components')
export class RiderCompPlanComponent {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    planId: number;

    @Column({ type: 'varchar', length: 80 })
    componentKey: string;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    @Column({ type: 'varchar', length: 32 })
    componentType: string;

    @Column({ type: 'varchar', length: 32 })
    calcBasis: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    value: number;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    conditions: Record<string, unknown>;

    @Column({ default: true })
    isEnabled: boolean;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => RiderCompPlan, (p) => p.components, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'plan_id' })
    plan: RiderCompPlan;
}
