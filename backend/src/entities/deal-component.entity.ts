import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { MenuItem } from './menu-item.entity';
import { MenuCategory } from './menu-category.entity';

export type DealSlotType = 'fixed' | 'choice_category' | 'choice_list';

@Entity('deal_components')
export class DealComponent {
    @PrimaryGeneratedColumn()
    id: number;

    /** The deal menu item (the bundle sold as one product). */
    @Column({ name: 'menu_item_id' })
    menuItemId: number;

    @Column({ name: 'slot_index', type: 'int' })
    slotIndex: number;

    @Column({ type: 'varchar', length: 32 })
    type: DealSlotType;

    /** For type 'fixed': the single menu item in this slot. */
    @Column({ name: 'source_menu_item_id', type: 'int', nullable: true })
    sourceMenuItemId: number | null;

    /** For type 'choice_category': pick one or more from this category. */
    @Column({ name: 'source_category_id', type: 'int', nullable: true })
    sourceCategoryId: number | null;

    /** For type 'choice_list': JSON array of menu_item ids to choose from. */
    @Column({ name: 'source_menu_item_ids', type: 'jsonb', nullable: true })
    sourceMenuItemIds: number[] | null;

    @Column({ type: 'int', default: 1 })
    quantity: number;

    @Column({ name: 'allow_customization', type: 'boolean', default: true })
    allowCustomization: boolean;

    /**
     * Per-choice price surcharge for this slot, keyed by source menu_item id
     * (e.g. { "<firey-special-wrap-id>": 100 } = "upgrade to Firey Special +Rs100").
     * Added to the deal price when the customer picks that item in this slot.
     * Null = no upsells; every choice is included at the deal price.
     */
    @Column({ name: 'slot_surcharges', type: 'jsonb', nullable: true })
    slotSurcharges: Record<string, number> | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => MenuItem, (mi) => mi.dealComponents, {
        onDelete: 'CASCADE',
    })
    menuItem: MenuItem;

    @ManyToOne(() => MenuItem, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'source_menu_item_id' })
    sourceMenuItem: MenuItem | null;

    @ManyToOne(() => MenuCategory, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'source_category_id' })
    sourceCategory: MenuCategory | null;
}
