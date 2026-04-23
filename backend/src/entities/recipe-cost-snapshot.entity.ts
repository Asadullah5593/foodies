import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Recipe } from './recipe.entity';

@Entity('recipe_cost_snapshots')
export class RecipeCostSnapshot {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    recipeId: number;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    computedAt: Date;

    @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 })
    totalCost: number;

    @Column({ type: 'varchar', nullable: true })
    currency: string | null;

    @Column({ type: 'jsonb', nullable: true })
    costBreakdown: Record<string, unknown> | null;

    @ManyToOne(() => Recipe, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'recipe_id' })
    recipe: Recipe;
}

