import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Recipe } from './recipe.entity';
import { InventoryItem } from './inventory-item.entity';
import { Uom } from './uom.entity';

@Entity('recipe_lines')
export class RecipeLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    recipeId: number;

    @Column()
    inventoryItemId: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    qty: number;

    @Column()
    uomId: number;

    /** Extra loss factor; e.g. 0.03 means 3% more consumption. */
    @Column({ type: 'decimal', precision: 9, scale: 6, nullable: true })
    wastageFactor: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Recipe, (r) => r.lines, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'recipe_id' })
    recipe: Recipe;

    @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'inventory_item_id' })
    inventoryItem: InventoryItem;

    @ManyToOne(() => Uom, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'uom_id' })
    uom: Uom;
}
