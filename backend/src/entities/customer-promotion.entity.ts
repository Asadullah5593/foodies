import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Promotion } from './promotion.entity';

@Entity('customer_promotions')
export class CustomerPromotion {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    customerId: number;

    @Column()
    promotionId: number;

    /** Generated coupon code once the customer claims the promotion */
    @Column({ type: 'varchar', nullable: true })
    couponCode: string | null;

    /** FK to discounts.id — created when the promotion is claimed */
    @Column({ type: 'integer', nullable: true })
    discountId: number | null;

    /** 'pending' | 'claimed' | 'used' | 'expired' */
    @Column({ default: 'pending' })
    status: string;

    @CreateDateColumn()
    assignedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    expiresAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    claimedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    usedAt: Date | null;

    @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
    customer: Customer;

    @ManyToOne(() => Promotion, (p) => p.customerPromotions, {
        onDelete: 'CASCADE',
    })
    promotion: Promotion;
}
