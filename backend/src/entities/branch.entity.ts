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
     * The branch "premises": radius in METRES around this branch's latitude /
     * longitude inside which a rider counts as on-site and therefore available
     * for assignment (auto-dispatch and manual alike).
     *
     * Not to be confused with `deliveryRadiusKm`, which is how far the branch
     * delivers TO customers. A branch with no coordinates cannot evaluate a
     * premises, and the check is skipped for it.
     */
    @Column({ type: 'int', default: 300 })
    premisesRadiusM: number;

    /**
     * Automatic rider assignment for this branch. When false, delivery orders
     * are left unassigned for an admin to hand out manually — every auto-dispatch
     * entry point funnels through OrdersService.autoAssignRiderForOrder, which
     * checks this flag. Manual assignment is unaffected.
     */
    @Column({ default: true })
    autoDispatchEnabled: boolean;

    /**
     * Per-tender GST rate (fraction, e.g. 0.15 = 15%). Pakistan FBR/PRA/SRB charge a REDUCED
     * rate on card/digital payments vs cash. Null = inherit the tenant's single default rate
     * (so unconfigured branches behave exactly as before). Set via branch admin.
     */
    @Column({
        name: 'gst_rate_cash',
        type: 'numeric',
        precision: 5,
        scale: 4,
        nullable: true,
    })
    gstRateCash: number | null;

    @Column({
        name: 'gst_rate_card',
        type: 'numeric',
        precision: 5,
        scale: 4,
        nullable: true,
    })
    gstRateCard: number | null;

    /**
     * FBR POS fiscalization. One registration per PHYSICAL branch — a single
     * POS ID + token covers every brand trading inside it. When enabled, each
     * pos/kiosk/consumer_app order is reported to FBR at placement and the
     * returned fiscal invoice number is stamped on the order. Never blocks the
     * sale: on failure the branch's last real number is reused (see
     * orders.fbr_number_source) and one background retry is scheduled.
     */
    @Column({ default: false })
    fbrEnabled: boolean;

    @Column({ type: 'varchar', nullable: true })
    fbrPosId: string | null;

    /** Bearer token issued by FBR for this POS registration. */
    @Column({ type: 'text', nullable: true })
    fbrToken: string | null;

    /** 'sandbox' | 'live' — which FBR endpoint this branch reports to. */
    @Column({ default: 'sandbox' })
    fbrEnvironment: string;

    /** PCT/HS code sent per invoice line. Null = the system default. */
    @Column({ type: 'varchar', nullable: true })
    fbrPctCode: string | null;

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
