import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Shift } from './shift.entity';
import { BranchMenuItem } from './branch-menu-item.entity';
import { BranchUser } from './branch-user.entity';
import { KitchenStation } from './kitchen-station.entity';
import { BranchBrand } from './branch-brand.entity';

@Entity('branches')
export class Branch {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ unique: true })
    code: string;

    @Column({ type: 'text', nullable: true })
    address: string | null;

    @Column({ type: 'varchar', nullable: true })
    phone: string | null;

    @Column({ type: 'varchar', nullable: true })
    email: string | null;

    @Column({ default: 'UTC' })
    timezone: string;

    @Column('simple-json', { nullable: true })
    operatingHours: Record<string, unknown> | null;

    @Column({ default: true })
    supportsDineIn: boolean;

    @Column({ default: true })
    supportsTakeaway: boolean;

    @Column({ default: true })
    supportsPickup: boolean;

    @Column({ default: false })
    supportsDelivery: boolean;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    deliveryFlatFee: number;

    @Column({ type: 'decimal', precision: 8, scale: 2, default: 10 })
    deliveryRadiusKm: number;

    /**
     * Whole-branch master switch. When false the branch is hidden from customers
     * and takes NO orders on any channel (online AND POS). For pausing a single
     * brand's online orders use branch_brands.is_open instead.
     */
    @Column({ default: true })
    isActive: boolean;

    @Column({ default: 'active' })
    status: string;

    @Column('simple-json', { nullable: true })
    settings: Record<string, unknown> | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    latitude: number | null;

    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    longitude: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @OneToMany(() => BranchBrand, (bb) => bb.branch, { cascade: true })
    branchBrands: BranchBrand[];

    @OneToMany(() => BranchUser, (bu) => bu.branch)
    branchUsers: BranchUser[];

    @OneToMany(() => Order, (o) => o.branch)
    orders: Order[];

    @OneToMany(() => Shift, (s) => s.branch)
    shifts: Shift[];

    @OneToMany(() => BranchMenuItem, (bmi) => bmi.branch)
    branchMenuItems: BranchMenuItem[];

    @OneToMany(() => KitchenStation, (ks) => ks.branch)
    kitchenStations: KitchenStation[];
}
