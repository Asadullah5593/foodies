import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    ManyToMany,
    OneToMany,
    JoinTable,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { Modifier } from './modifier.entity';
import { MenuItem } from './menu-item.entity';

@Entity('modifier_groups')
export class ModifierGroup {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    brandId: number;

    @Column()
    name: string;

    @Column({ default: 0 })
    minSelect: number;

    @Column({ default: 1 })
    maxSelect: number;

    /**
     * Number of selected units in this group that are included free before any are
     * charged ("first N free"), e.g. "1 dip free, extra dip charged" ⇒ includedQuantity = 1.
     * Units are counted by quantity, so selecting the same modifier twice ("double meat")
     * consumes two units. 0 = every selection is charged at its price.
     */
    @Column({ name: 'included_quantity', default: 0 })
    includedQuantity: number;

    /**
     * Per-size override of `includedQuantity`, keyed by `MenuVariant.sizeKey`,
     * e.g. { "7": 2, "10": 2, "12": 3, "14": 3 } ("choose 2 meats free on 7\"/10\", 3 on 12\"/14\"").
     * When the ordered line's variant sizeKey is present here, this value wins over
     * `includedQuantity`. Null ⇒ use `includedQuantity` for all sizes.
     */
    @Column({ name: 'included_by_size', type: 'jsonb', nullable: true })
    includedBySize: Record<string, number> | null;

    /**
     * Allow the same option to be picked multiple times (qty stepper) even when it is
     * free and optional — e.g. "Add a Sauce" (extra BBQ ×2). Priced options, free-allowance
     * groups and "choose N" groups are already repeatable regardless of this flag; it exists
     * for free, optional groups that should still repeat (vs. yes/no toggles like "Remove a filling").
     */
    @Column({ name: 'allow_quantity', default: false })
    allowQuantity: boolean;

    /**
     * Quantity-tiered bundle price for the CHARGED units in this group (after the free
     * allowance), keyed by charged-unit count → total charge. e.g. dips: {"1":99,"2":169,"3":249}
     * means 1 extra dip = 99, 2 = 169, 3 = 249 (not 99 each). When set, this overrides the
     * per-modifier price for the group's charged portion. Counts beyond the table extrapolate
     * from the last marginal step. Null = ordinary per-unit pricing.
     */
    @Column({ name: 'price_tiers', type: 'jsonb', nullable: true })
    priceTiers: Record<string, number> | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Brand, (b) => b.modifierGroups, { onDelete: 'CASCADE' })
    brand: Brand;

    @OneToMany(() => Modifier, (m) => m.modifierGroup)
    modifiers: Modifier[];

    @ManyToMany(() => MenuItem, (mi) => mi.modifierGroups)
    @JoinTable({
        name: 'menu_item_modifier_groups',
        joinColumn: { name: 'modifier_group_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'menu_item_id', referencedColumnName: 'id' },
    })
    menuItems: MenuItem[];
}
