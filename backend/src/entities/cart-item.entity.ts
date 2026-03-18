import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Cart } from './cart.entity';
import { MenuItem } from './menu-item.entity';
import { MenuVariant } from './menu-variant.entity';

@Entity('cart_items')
export class CartItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    cartId: number;

    @Column()
    menuItemId: number;

    @Column({ nullable: true })
    variantId: number | null;

    @Column({ type: 'int', default: 1 })
    quantity: number;

    @Column({ type: 'varchar', nullable: true })
    notes: string | null;

    /** JSON array of { addon_id: number, quantity?: number } */
    @Column({ type: 'jsonb', nullable: true })
    addons: { addon_id: number; quantity?: number }[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Cart, (c) => c.items, { onDelete: 'CASCADE' })
    cart: Cart;

    @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
    menuItem: MenuItem;

    @ManyToOne(() => MenuVariant, { onDelete: 'SET NULL' })
    variant: MenuVariant | null;
}
