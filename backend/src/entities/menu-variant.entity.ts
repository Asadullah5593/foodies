import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { MenuItem } from './menu-item.entity';
import { OrderItem } from './order-item.entity';

@Entity('menu_variants')
export class MenuVariant {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    menuItemId: number;

    @Column()
    name: string;

    /**
     * Normalized size identifier shared across menu items (e.g. '7', '10', '12', '14'
     * for pizza sizes). Lets size-dependent modifier pricing (`priceBySize`) and
     * free-topping allowances (`ModifierGroup.includedBySize`) key off a stable size,
     * since modifier groups are shared M2M across items that each have their own variant rows.
     * Null = no size semantics (non-pizza items).
     */
    @Column({ name: 'size_key', type: 'varchar', length: 32, nullable: true })
    sizeKey: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    priceModifier: number;

    /** Unit cost (COGS) for this variant; null = unknown (no cost floor). */
    @Column({ name: 'cost_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
    costPrice: number | null;

    @Column({ default: false })
    isDefault: boolean;

    @Column({ default: 0 })
    sortOrder: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => MenuItem, (i) => i.variants, { onDelete: 'CASCADE' })
    menuItem: MenuItem;

    @OneToMany(() => OrderItem, (oi) => oi.variant)
    orderItems: OrderItem[];
}
