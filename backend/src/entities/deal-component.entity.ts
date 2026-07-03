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
     * Optional slot: the customer may add 0..quantity units instead of exactly `quantity`.
     * Used for "add a drink(s)" style upsells where any number (including repeats of the same
     * item) is allowed and picking none is also valid. Only meaningful for choice slots
     * (`choice_list` / `choice_category`); ignored for 'fixed'. Server prices whatever is sent.
     */
    @Column({ name: 'optional', type: 'boolean', default: false })
    optional: boolean;

    /**
     * Per-choice price surcharge for this slot, keyed by source menu_item id
     * (e.g. { "<firey-special-wrap-id>": 100 } = "upgrade to Firey Special +Rs100").
     * Added to the deal price when the customer picks that item in this slot.
     * Null = no upsells; every choice is included at the deal price.
     */
    @Column({ name: 'slot_surcharges', type: 'jsonb', nullable: true })
    slotSurcharges: Record<string, number> | null;

    /**
     * Lock this slot's chosen item to a single variant size (by `MenuVariant.sizeKey`),
     * e.g. '12' = "All 12\" pizza options". When set, the customer can't change the size
     * during customization and toppings price at that size. Null = any size.
     */
    @Column({ name: 'slot_size_key', type: 'varchar', length: 32, nullable: true })
    slotSizeKey: string | null;

    /**
     * Whitelist of variant sizeKeys allowed in this slot (e.g. ['12','14'] = "Large/XLarge
     * only"). Stronger than slotSizeKey (a single lock) because a BOGO slot must allow EITHER
     * 12" or 14". Null = any size. Enforced server-side at order time.
     */
    @Column({ name: 'allowed_size_keys', type: 'jsonb', nullable: true })
    allowedSizeKeys: string[] | null;

    /**
     * Cross-slot "mirror" constraint: when set, this slot's chosen item must MATCH the
     * referenced slot's pick. Used for BOGO's 2nd pizza ("same size & same category as the
     * first"). Null = independent slot.
     */
    @Column({ name: 'mirror_slot_index', type: 'int', nullable: true })
    mirrorSlotIndex: number | null;

    /** With mirrorSlotIndex set: this slot's variant size must equal the mirrored slot's size. */
    @Column({ name: 'mirror_match_size', type: 'boolean', default: false })
    mirrorMatchSize: boolean;

    /**
     * With mirrorSlotIndex set: this slot's item must be the same STRICT category as the
     * mirrored slot's — same catalog category AND same label (Classic↔Classic, Signature↔
     * Signature; Build-Your-Own is its own category).
     */
    @Column({ name: 'mirror_match_category', type: 'boolean', default: false })
    mirrorMatchCategory: boolean;

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
