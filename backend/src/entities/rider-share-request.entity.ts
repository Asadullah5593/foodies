import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Brand } from './brand.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';

export type RiderShareRequestStatus =
    | 'pending'
    | 'approved'
    | 'declined'
    | 'cancelled';

/**
 * A brand admin's request for a Foodies-pool rider to be shared to their brand.
 * The owner/GM approves (creating a 'shared' rider_brands link) or declines.
 * A partial unique index (status = 'pending') allows only one open request per
 * (requesting_brand, rider); re-requesting after a decline/cancel is allowed.
 */
@Entity('rider_share_requests')
@Index('IDX_rider_share_requests_tenant_status', ['tenantId', 'status'])
export class RiderShareRequest {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    requestingBrandId: number;

    @Column()
    riderUserId: number;

    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status: RiderShareRequestStatus;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    @Column({ type: 'int', nullable: true })
    requestedBy: number | null;

    @Column({ type: 'int', nullable: true })
    reviewedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    reviewedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    reviewNote: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Brand, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'requesting_brand_id' })
    requestingBrand: Brand;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'rider_user_id' })
    rider: User;
}
