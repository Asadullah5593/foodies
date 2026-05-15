import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    ManyToMany,
    JoinTable,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { MenuCategory } from './menu-category.entity';
import { MenuVariant } from './menu-variant.entity';
import { MenuAddon } from './menu-addon.entity';
import { BranchMenuItem } from './branch-menu-item.entity';
import { OrderItem } from './order-item.entity';
import { ModifierGroup } from './modifier-group.entity';
import { DealComponent } from './deal-component.entity';

@Entity('menu_items')
export class MenuItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'brand_id' })
    brandId: number;

    @Column()
    categoryId: number;

    @Column()
    name: string;

    @Column()
    slug: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'varchar', nullable: true })
    imageUrl: string | null;

    /**
     * Extra product photos (ordered). Shown on consumer web below main `imageUrl` in a gallery/slider.
     * Main thumbnail for POS/menu grids remains `imageUrl` only.
     */
    @Column({
        name: 'gallery_image_urls',
        type: 'jsonb',
        nullable: true,
    })
    galleryImageUrls: string[] | null;

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    basePrice: number;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: 0 })
    sortOrder: number;

    /** If true, this item is only used inside deals and must not be shown on POS as a standalone item. */
    @Column({ name: 'deal_only', default: false })
    dealOnly: boolean;

    /**
     * Which order channels this item can be sold on: `delivery`, `pickup`, `dine_in`.
     * Null or empty (legacy) means all channels. POS `takeaway` maps to `pickup` when checking orders.
     */
    @Column({
        name: 'available_for_order_types',
        type: 'jsonb',
        nullable: true,
    })
    availableForOrderTypes: string[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Brand, (b) => b.menuItems, { onDelete: 'CASCADE' })
    brand: Brand;

    @ManyToOne(() => MenuCategory, (c) => c.menuItems, { onDelete: 'CASCADE' })
    category: MenuCategory;

    @OneToMany(() => MenuVariant, (v) => v.menuItem)
    variants: MenuVariant[];

    @ManyToMany(() => MenuAddon, (a) => a.menuItems)
    @JoinTable({
        name: 'menu_item_addons',
        joinColumn: { name: 'menu_item_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'addon_id', referencedColumnName: 'id' },
    })
    addons: MenuAddon[];

    @OneToMany(() => BranchMenuItem, (bmi) => bmi.menuItem)
    branchMenuItems: BranchMenuItem[];

    @ManyToMany(() => ModifierGroup, (mg) => mg.menuItems)
    modifierGroups: ModifierGroup[];

    @OneToMany(() => OrderItem, (oi) => oi.menuItem)
    orderItems: OrderItem[];

    @OneToMany(() => DealComponent, (dc) => dc.menuItem)
    dealComponents: DealComponent[];
}
