import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { Order } from './order.entity';
import { Discount } from './discount.entity';
import { TenantUser } from './tenant-user.entity';

@Entity('tenants')
export class Tenant {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    legalName: string | null;

    @Column({ unique: true })
    slug: string;

    @Column({ length: 3, default: 'PKR' })
    defaultCurrency: string;

    @Column({ default: 'UTC' })
    defaultTimezone: string;

    @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
    defaultTaxRate: number;

    @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
    defaultServiceCharge: number;

    @Column({ default: false })
    loyaltyEnabled: boolean;

    @Column({ default: 'active' })
    status: string;

    @Column('simple-json', { nullable: true })
    settings: Record<string, unknown> | null;

    /** Configurable loyalty: displayName, spendPerPoint, minOrderToEarn, cashValuePerPoint, minOrderToRedeem, expiryPeriod, expiryUnit */
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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @OneToMany(() => Brand, (b) => b.tenant)
    brands: Brand[];

    @OneToMany(() => TenantUser, (tu) => tu.tenant)
    tenantUsers: TenantUser[];

    @OneToMany(() => Order, (o) => o.tenant)
    orders: Order[];

    @OneToMany(() => Discount, (d) => d.tenant)
    discounts: Discount[];
}
