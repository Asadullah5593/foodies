import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { MenuItem } from './menu-item.entity';
import { MenuVariant } from './menu-variant.entity';
import { Uom } from './uom.entity';
import { User } from './user.entity';
import { RecipeLine } from './recipe-line.entity';

@Entity('recipes')
export class Recipe {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    menuItemId: number;

    @Column({ type: 'int', nullable: true })
    variantId: number | null;

    @Column({ default: 1 })
    version: number;

    /** draft | active | archived */
    @Column({ default: 'draft' })
    status: string;

    @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
    yieldQty: number | null;

    @Column({ type: 'int', nullable: true })
    yieldUomId: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => MenuItem, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'menu_item_id' })
    menuItem: MenuItem;

    @ManyToOne(() => MenuVariant, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'variant_id' })
    variant: MenuVariant | null;

    @ManyToOne(() => Uom, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'yield_uom_id' })
    yieldUom: Uom | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;

    @OneToMany(() => RecipeLine, (l) => l.recipe)
    lines: RecipeLine[];
}

