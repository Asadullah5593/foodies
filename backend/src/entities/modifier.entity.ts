import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { ModifierGroup } from './modifier-group.entity';

@Entity('modifiers')
export class Modifier {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    modifierGroupId: number;

    @Column()
    name: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    price: number;

    /**
     * Optional per-size surcharge map keyed by `MenuVariant.sizeKey`,
     * e.g. { "7": 99, "10": 149, "12": 249, "14": 349 } for an "Extra Cheese" topping.
     * When the ordered line's variant has a sizeKey present in this map, that price is
     * used instead of the flat `price`. Null/empty ⇒ flat `price` applies to every size
     * (so all existing non-size-dependent modifiers keep working unchanged).
     */
    @Column({ name: 'price_by_size', type: 'jsonb', nullable: true })
    priceBySize: Record<string, number> | null;

    /**
     * Restrict this option to certain variant sizes (by `MenuVariant.sizeKey`),
     * e.g. ["10","12","14"] = "Thin Crust not available on 7\"". Null/empty = every size.
     * Ignored when the parent line has no size.
     */
    @Column({ name: 'available_for_sizes', type: 'jsonb', nullable: true })
    availableForSizes: string[] | null;

    @Column({ default: 0 })
    sortOrder: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => ModifierGroup, (mg) => mg.modifiers, {
        onDelete: 'CASCADE',
    })
    modifierGroup: ModifierGroup;
}
