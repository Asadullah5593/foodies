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
import { CustomerPromotion } from './customer-promotion.entity';

@Entity('promotions')
export class Promotion {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'varchar', nullable: true })
    imageUrl: string | null;

    /** 'discount' | 'free_item' */
    @Column({ type: 'varchar' })
    promotionType: string;

    /** 'flat' | 'percentage' — only when promotionType = 'discount' */
    @Column({ type: 'varchar', nullable: true })
    discountType: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    discountValue: number | null;

    /** Menu item to award for free — only when promotionType = 'free_item' */
    @Column({ type: 'integer', nullable: true })
    freeMenuItemId: number | null;

    /** 'new_customer' | 'manual' */
    @Column({ type: 'varchar', default: 'new_customer' })
    eligibilityType: string;

    @Column({ default: true })
    isActive: boolean;

    /** How many days after assignment before the CustomerPromotion expires */
    @Column({ type: 'integer', nullable: true })
    expiresInDays: number | null;

    /** Promotion is only assignable after this date */
    @Column({ type: 'timestamp', nullable: true })
    validFrom: Date | null;

    /** Promotion is no longer assignable after this date */
    @Column({ type: 'timestamp', nullable: true })
    validUntil: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, (t) => t.promotions, { onDelete: 'CASCADE' })
    tenant: Tenant;

    @OneToMany(() => CustomerPromotion, (cp) => cp.promotion)
    customerPromotions: CustomerPromotion[];
}
