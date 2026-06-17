import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { BranchBrand } from './branch-brand.entity';
import { ModifierGroup } from './modifier-group.entity';
import { MenuCategory } from './menu-category.entity';
import { MenuItem } from './menu-item.entity';
import { MenuAddon } from './menu-addon.entity';

@Entity('brands')
export class Brand {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    name: string;

    @Column()
    slug: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'varchar', nullable: true })
    logoUrl: string | null;

    @Column({ default: true })
    isActive: boolean;

    /** Flat delivery fee charged on each delivery order of this brand. */
    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    deliveryFlatFee: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, (t) => t.brands, { onDelete: 'CASCADE' })
    tenant: Tenant;

    @OneToMany(() => BranchBrand, (bb) => bb.brand, { cascade: true })
    branchBrands: BranchBrand[];

    @OneToMany(() => ModifierGroup, (mg) => mg.brand)
    modifierGroups: ModifierGroup[];

    @OneToMany(() => MenuCategory, (c) => c.brand)
    menuCategories: MenuCategory[];

    @OneToMany(() => MenuItem, (i) => i.brand)
    menuItems: MenuItem[];

    @OneToMany(() => MenuAddon, (a) => a.brand)
    menuAddons: MenuAddon[];
}
