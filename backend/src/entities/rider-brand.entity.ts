import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';

/**
 * Which brands a rider serves (availability). Single source of truth for
 * rider↔brand ownership and sharing:
 *  - source = 'owned'  → the brand created/owns this rider; auto-created when a
 *    rider-role branch_users row carries a brand_id. At most one 'owned' link.
 *  - source = 'shared' → the rider is shared to the brand (a Foodies-pool rider
 *    linked by owner/GM, or an approved share request).
 * A rider with no row here is a "pool rider" and is NOT dispatchable until linked.
 * Keyed on the rider USER id because orders/dispatch reference users.id.
 */
@Entity('rider_brands')
@Index('IDX_rider_brands_brand_rider', ['brandId', 'riderUserId'])
@Index('IDX_rider_brands_tenant_rider', ['tenantId', 'riderUserId'])
export class RiderBrand {
    @PrimaryColumn()
    riderUserId: number;

    @PrimaryColumn()
    brandId: number;

    @Column()
    tenantId: number;

    @Column({ type: 'varchar', length: 16, default: 'shared' })
    source: 'owned' | 'shared';

    /** Audit only — intentionally no FK so deleting a user keeps links intact. */
    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'rider_user_id' })
    rider: User;

    @ManyToOne(() => Brand, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;
}
