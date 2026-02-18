import {
    Injectable,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { Order } from '../entities/order.entity';
import { Customer } from '../entities/customer.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { normalizePakistaniPhone } from '../utils/phone';

const DEFAULT_SPEND_PER_POINT = 1000;
const DEFAULT_MIN_ORDER_TO_EARN = 1;
const DEFAULT_CASH_VALUE_PER_POINT = 10;
const DEFAULT_MIN_ORDER_TO_REDEEM = 1;

@Injectable()
export class LoyaltyService {
    constructor(
        @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(Customer) private customerRepo: Repository<Customer>,
        @InjectRepository(LoyaltyTransaction)
        private txRepo: Repository<LoyaltyTransaction>,
    ) {}

    private getSettings(tenant: Tenant) {
        const s = tenant.loyaltySettings ?? {};
        return {
            spendPerPoint: s.spendPerPoint ?? DEFAULT_SPEND_PER_POINT,
            minOrderToEarn: s.minOrderToEarn ?? DEFAULT_MIN_ORDER_TO_EARN,
            cashValuePerPoint: s.cashValuePerPoint ?? DEFAULT_CASH_VALUE_PER_POINT,
            minOrderToRedeem: s.minOrderToRedeem ?? DEFAULT_MIN_ORDER_TO_REDEEM,
            displayName: s.displayName ?? 'Reward Points',
        };
    }

    async earnOnOrderComplete(orderId: number) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: ['customer'],
        });
        if (!order) return;
        if ((order.loyaltyPointsEarned ?? 0) > 0) return;

        const tenant = await this.tenantRepo.findOne({
            where: { id: order.tenantId },
        });
        if (!tenant?.loyaltyEnabled) return;

        const settings = this.getSettings(tenant);
        const orderTotal = Number(order.totalAmount);
        if (orderTotal < settings.minOrderToEarn) return;

        let customer: Customer | null = order.customer ?? null;
        const phone = order.customerPhone?.trim();
        if (!customer && phone) {
            const normalized = normalizePakistaniPhone(phone);
            if (normalized) {
                customer = await this.customerRepo.findOne({
                    where: { tenantId: order.tenantId, phone: normalized },
                });
                if (!customer) {
                    customer = await this.customerRepo.save(
                        this.customerRepo.create({
                            tenantId: order.tenantId,
                            phone: normalized,
                            name: order.customerName ?? 'Customer',
                            loyaltyPointsBalance: 0,
                        }),
                    );
                }
            }
        }
        if (!customer) return;

        const points = Math.floor(orderTotal / settings.spendPerPoint);
        if (points <= 0) return;

        await this.txRepo.save(
            this.txRepo.create({
                customerId: customer.id,
                orderId: order.id,
                points,
                type: 'earn',
            }),
        );
        customer.loyaltyPointsBalance =
            (customer.loyaltyPointsBalance || 0) + points;
        await this.customerRepo.save(customer);

        await this.orderRepo.update(orderId, { loyaltyPointsEarned: points });
    }

    /** Revoke points previously earned when order status is changed away from completed. */
    async revokeEarnedPoints(orderId: number) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: ['customer'],
        });
        if (!order) return;
        const pointsToRevoke = order.loyaltyPointsEarned ?? 0;
        if (pointsToRevoke <= 0) return;

        let customer: Customer | null = order.customer ?? null;
        const phone = order.customerPhone?.trim();
        if (!customer && phone) {
            const normalized = normalizePakistaniPhone(phone);
            if (normalized) {
                customer = await this.customerRepo.findOne({
                    where: { tenantId: order.tenantId, phone: normalized },
                });
            }
        }
        if (!customer) return;

        const balance = customer.loyaltyPointsBalance ?? 0;
        customer.loyaltyPointsBalance = Math.max(0, balance - pointsToRevoke);
        await this.customerRepo.save(customer);

        await this.txRepo.save(
            this.txRepo.create({
                customerId: customer.id,
                orderId: order.id,
                points: -pointsToRevoke,
                type: 'adjust',
            }),
        );
        await this.orderRepo.update(orderId, { loyaltyPointsEarned: 0 });
    }

    /**
     * Compute max redeemable points and discount for an order (for quote/validation).
     * Returns { redeemablePoints, discountAmount, displayName } or null if loyalty disabled / no customer.
     */
    async getRedeemPreview(
        tenantId: number,
        customerPhone: string,
        orderTotalAfterOtherDiscounts: number,
    ): Promise<{
        redeemablePoints: number;
        discountAmount: number;
        displayName: string;
        cashValuePerPoint: number;
        minOrderToRedeem: number;
    } | null> {
        const tenant = await this.tenantRepo.findOne({
            where: { id: tenantId },
        });
        if (!tenant?.loyaltyEnabled) return null;
        const normalized = normalizePakistaniPhone(customerPhone);
        if (!normalized) return null;
        const customer = await this.customerRepo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (!customer) return null;
        const settings = this.getSettings(tenant);
        if (orderTotalAfterOtherDiscounts < settings.minOrderToRedeem)
            return null;
        const balance = customer.loyaltyPointsBalance ?? 0;
        const maxDiscount = balance * settings.cashValuePerPoint;
        const redeemablePoints = Math.min(
            balance,
            Math.floor(orderTotalAfterOtherDiscounts / settings.cashValuePerPoint),
        );
        const discountAmount = redeemablePoints * settings.cashValuePerPoint;
        return {
            redeemablePoints,
            discountAmount,
            displayName: settings.displayName,
            cashValuePerPoint: settings.cashValuePerPoint,
            minOrderToRedeem: settings.minOrderToRedeem,
        };
    }

    /**
     * Redeem points at POS: deduct from customer, create transaction, return discount amount.
     */
    async redeemForOrder(
        tenantId: number,
        customerPhone: string,
        orderId: number,
        pointsToRedeem: number,
        orderTotalAfterOtherDiscounts: number,
    ): Promise<{ discountAmount: number }> {
        const tenant = await this.tenantRepo.findOne({
            where: { id: tenantId },
        });
        if (!tenant?.loyaltyEnabled) {
            throw new BadRequestException('Loyalty points are not enabled');
        }
        const normalized = normalizePakistaniPhone(customerPhone);
        if (!normalized) {
            throw new BadRequestException('Invalid customer phone for loyalty');
        }
        const customer = await this.customerRepo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (!customer) {
            throw new BadRequestException('Customer not found for this phone');
        }
        const settings = this.getSettings(tenant);
        if (orderTotalAfterOtherDiscounts < settings.minOrderToRedeem) {
            throw new BadRequestException(
                `Minimum order amount to redeem points is ${settings.minOrderToRedeem}`,
            );
        }
        const balance = customer.loyaltyPointsBalance ?? 0;
        if (pointsToRedeem <= 0 || pointsToRedeem > balance) {
            throw new BadRequestException(
                `You can redeem up to ${balance} points`,
            );
        }
        const discountAmount = pointsToRedeem * settings.cashValuePerPoint;
        if (discountAmount > orderTotalAfterOtherDiscounts) {
            throw new BadRequestException(
                'Redeem amount cannot exceed order total',
            );
        }

        customer.loyaltyPointsBalance = balance - pointsToRedeem;
        await this.customerRepo.save(customer);
        await this.txRepo.save(
            this.txRepo.create({
                customerId: customer.id,
                orderId,
                points: -pointsToRedeem,
                type: 'redeem',
            }),
        );
        return { discountAmount };
    }

    /** Get loyalty balance by phone (for consumer app). Tenant from branch or explicit. */
    async getBalanceByPhone(
        tenantId: number,
        phone: string,
    ): Promise<{
        balance: number;
        displayName: string;
        spendPerPoint: number;
        cashValuePerPoint: number;
        minOrderToEarn: number;
        minOrderToRedeem: number;
    } | null> {
        const tenant = await this.tenantRepo.findOne({
            where: { id: tenantId },
        });
        if (!tenant?.loyaltyEnabled) return null;
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return null;
        const customer = await this.customerRepo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (!customer) {
            return {
                balance: 0,
                ...this.getSettings(tenant),
            };
        }
        return {
            balance: customer.loyaltyPointsBalance ?? 0,
            ...this.getSettings(tenant),
        };
    }
}
