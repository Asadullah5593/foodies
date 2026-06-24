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

export type DeliveryTierKey = 'saver' | 'standard' | 'priority';

/** Config for one service tier of a brand's tier-based delivery. */
export interface DeliveryTierConfig {
    enabled: boolean;
    name: string;
    /** Distance-band fees, ascending by maxKm. First band whose maxKm >= distance wins. */
    bands: { maxKm: number; fee: number }[];
    etaMinMinutes: number;
    etaMaxMinutes: number;
}

/** Per-brand tier-based delivery configuration (stored as simple-json on the brand). */
export interface BrandDeliveryTiers {
    saver: DeliveryTierConfig;
    standard: DeliveryTierConfig;
    priority: DeliveryTierConfig;
    /** Minutes a saver order is held before dispatch (Phase 2 dispatch engine). */
    saverHoldMinutes?: number;
    /** Max orders a rider may be batched with (Phase 3; 1 = no batching). */
    maxBatchSize?: number;
}

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

    /** Whether this brand runs a loyalty program (per-brand; replaces tenant-level loyaltyEnabled). */
    @Column({ default: false })
    loyaltyEnabled: boolean;

    /** Per-brand loyalty config: displayName, spendPerPoint, minOrderToEarn, cashValuePerPoint, minOrderToRedeem, expiryPeriod, expiryUnit */
    @Column('simple-json', { nullable: true })
    loyaltySettings: {
        displayName?: string;
        spendPerPoint?: number;
        minOrderToEarn?: number;
        cashValuePerPoint?: number;
        minOrderToRedeem?: number;
        expiryPeriod?: number;
        expiryUnit?: 'day' | 'month' | 'year';
    } | null;

    /** Whether this brand offers tier-based delivery (opt-in). When false, deliveryFlatFee is used. */
    @Column({ default: false })
    deliveryTiersEnabled: boolean;

    /** Per-brand Saver/Standard/Priority delivery config (fees per distance band + static ETAs). */
    @Column('simple-json', { nullable: true })
    deliveryTiers: BrandDeliveryTiers | null;

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
