import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
    Unique,
} from 'typeorm';
import { Branch } from './branch.entity';
import { MenuItem } from './menu-item.entity';

@Entity('branch_menu_items')
@Unique(['branchId', 'menuItemId'])
export class BranchMenuItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    branchId: number;

    /** Points to brand-owned menu_item. Branch controls how it is sold. */
    @Column()
    menuItemId: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    priceOverride: number | null;

    @Column({ default: true })
    isAvailable: boolean;

    @Column({ default: false })
    isHiddenOnline: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Branch, (b) => b.branchMenuItems, { onDelete: 'CASCADE' })
    branch: Branch;

    @ManyToOne(() => MenuItem, (i) => i.branchMenuItems, {
        onDelete: 'CASCADE',
    })
    menuItem: MenuItem;
}
