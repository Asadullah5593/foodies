import {
    Injectable,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { Customer } from '../entities/customer.entity';
import { Brand } from '../entities/brand.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyWallet } from '../entities/loyalty-wallet.entity';
import { normalizePakistaniPhone } from '../utils/phone';
import { CustomersService } from '../customers/customers.service';

const DEFAULT_SPEND_PER_POINT = 1000;
const DEFAULT_MIN_ORDER_TO_EARN = 1;
const DEFAULT_CASH_VALUE_PER_POINT = 10;
const DEFAULT_MIN_ORDER_TO_REDEEM = 1;
const DEFAULT_EXPIRY_PERIOD = 365;
const DEFAULT_EXPIRY_UNIT: 'day' | 'month' | 'year' = 'day';

export type WalletType = 'pos' | 'app';

export interface BrandLoyaltySettings {
    enabled: boolean;
    displayName: string;
    spendPerPoint: number;
    minOrderToEarn: number;
    cashValuePerPoint: number;
    minOrderToRedeem: number;
    expiryPeriod: number;
    expiryUnit: 'day' | 'month' | 'year';
}

/**
 * Maps an order's `source` to the wallet it earns/redeems against.
 *  - 'pos'          -> brand-scoped POS wallet
 *  - 'consumer_app' -> shared APP wallet
 *  - 'kiosk' / 'consumer_web' / anything else -> null (no loyalty at all)
 */
export function mapSourceToWalletType(source: string): WalletType | null {
    if (source === 'pos') return 'pos';
    if (source === 'consumer_app') return 'app';
    return null;
}

@Injectable()
export class LoyaltyService {
    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(Customer) private customerRepo: Repository<Customer>,
        @InjectRepository(Brand) private brandRepo: Repository<Brand>,
        @InjectRepository(LoyaltyTransaction)
        private txRepo: Repository<LoyaltyTransaction>,
        @InjectRepository(LoyaltyWallet)
        private walletRepo: Repository<LoyaltyWallet>,
        private dataSource: DataSource,
        private customersService: CustomersService,
    ) {}

    // ---------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------

    /** Resolve a brand's loyalty config, falling back to platform defaults per field. */
    async getBrandLoyaltySettings(
        brandId: number | null,
    ): Promise<BrandLoyaltySettings> {
        const brand =
            brandId != null
                ? await this.brandRepo.findOne({ where: { id: brandId } })
                : null;
        const s = brand?.loyaltySettings ?? {};
        return {
            enabled: brand?.loyaltyEnabled ?? false,
            displayName: s.displayName ?? 'Reward Points',
            spendPerPoint: s.spendPerPoint ?? DEFAULT_SPEND_PER_POINT,
            minOrderToEarn: s.minOrderToEarn ?? DEFAULT_MIN_ORDER_TO_EARN,
            cashValuePerPoint:
                s.cashValuePerPoint ?? DEFAULT_CASH_VALUE_PER_POINT,
            minOrderToRedeem: s.minOrderToRedeem ?? DEFAULT_MIN_ORDER_TO_REDEEM,
            expiryPeriod: s.expiryPeriod ?? DEFAULT_EXPIRY_PERIOD,
            expiryUnit: s.expiryUnit ?? DEFAULT_EXPIRY_UNIT,
        };
    }

    private computeExpiry(
        period: number,
        unit: 'day' | 'month' | 'year',
    ): Date | null {
        if (!period || period <= 0) return null;
        const d = new Date();
        if (unit === 'year') d.setFullYear(d.getFullYear() + period);
        else if (unit === 'month') d.setMonth(d.getMonth() + period);
        else d.setDate(d.getDate() + period);
        return d;
    }

    // ---------------------------------------------------------------------
    // Wallet helpers
    // ---------------------------------------------------------------------

    /**
     * Ensure the wallet row exists (idempotent, own statement so a concurrent
     * race resolves via ON CONFLICT instead of aborting the caller's transaction).
     */
    private async ensureWalletRow(
        tenantId: number,
        customerId: number,
        walletType: WalletType,
        brandId: number | null,
    ): Promise<void> {
        if (walletType === 'pos') {
            await this.dataSource.query(
                `INSERT INTO loyalty_wallets (tenant_id, customer_id, wallet_type, brand_id, balance, created_at, updated_at)
                 VALUES ($1, $2, 'pos', $3, 0, now(), now())
                 ON CONFLICT (customer_id, brand_id) WHERE wallet_type = 'pos' DO NOTHING`,
                [tenantId, customerId, brandId],
            );
        } else {
            await this.dataSource.query(
                `INSERT INTO loyalty_wallets (tenant_id, customer_id, wallet_type, brand_id, balance, created_at, updated_at)
                 VALUES ($1, $2, 'app', NULL, 0, now(), now())
                 ON CONFLICT (customer_id) WHERE wallet_type = 'app' DO NOTHING`,
                [tenantId, customerId],
            );
        }
    }

    /** Lock and return the wallet row (must exist — call ensureWalletRow first). */
    private async lockWallet(
        manager: EntityManager,
        customerId: number,
        walletType: WalletType,
        brandId: number | null,
    ): Promise<LoyaltyWallet | null> {
        return manager.findOne(LoyaltyWallet, {
            where: {
                customerId,
                walletType,
                brandId: walletType === 'app' ? IsNull() : (brandId as number),
            },
            lock: { mode: 'pessimistic_write' },
        });
    }

    // ---------------------------------------------------------------------
    // Earn
    // ---------------------------------------------------------------------

    /** Award points when an order is completed. Idempotent; no-op for non-loyalty channels. */
    async earnOnOrderComplete(orderId: number) {
        const order = await this.orderRepo.findOne({
            where: { id: orderId },
            relations: ['customer'],
        });
        if (!order) return;
        if ((order.loyaltyPointsEarned ?? 0) > 0) return; // idempotency

        const walletType = mapSourceToWalletType(order.source);
        if (!walletType) return; // kiosk / consumer_web -> no loyalty

        const settings = await this.getBrandLoyaltySettings(order.brandId);
        if (!settings.enabled) return;

        const orderTotal = Number(order.totalAmount);
        if (orderTotal < settings.minOrderToEarn) return;

        let customer: Customer | null = order.customer ?? null;
        const phone = order.customerPhone?.trim();
        if (!customer && phone) {
            const normalized = normalizePakistaniPhone(phone);
            if (normalized) {
                customer =
                    await this.customersService.findOrCreateTenantCustomerForPhone(
                        order.tenantId,
                        normalized,
                        order.customerName ?? 'Customer',
                    );
                if (order.customerId == null) {
                    await this.orderRepo.update(orderId, {
                        customerId: customer.id,
                    });
                }
            }
        }
        if (!customer) return;

        const points = Math.floor(orderTotal / settings.spendPerPoint);
        if (points <= 0) return;

        const brandKey = walletType === 'app' ? null : order.brandId;
        const expiry = this.computeExpiry(
            settings.expiryPeriod,
            settings.expiryUnit,
        );

        await this.ensureWalletRow(
            order.tenantId,
            customer.id,
            walletType,
            brandKey,
        );
        await this.dataSource.transaction(async (manager) => {
            const wallet = await this.lockWallet(
                manager,
                customer.id,
                walletType,
                brandKey,
            );
            if (!wallet) return;
            await manager.save(
                manager.create(LoyaltyTransaction, {
                    customerId: customer.id,
                    orderId: order.id,
                    walletId: wallet.id,
                    walletType,
                    brandId: brandKey,
                    points,
                    type: 'earn',
                    expiryDate: expiry,
                    pointsRemaining: points,
                    expired: false,
                }),
            );
            await manager.update(LoyaltyWallet, wallet.id, {
                balance: wallet.balance + points,
            });
            await manager.update(Order, orderId, {
                loyaltyPointsEarned: points,
            });
        });
    }

    /** Reverse points earned by an order when it leaves the completed state. */
    async revokeEarnedPoints(orderId: number) {
        const order = await this.orderRepo.findOne({ where: { id: orderId } });
        if (!order) return;
        if ((order.loyaltyPointsEarned ?? 0) <= 0) return;

        await this.dataSource.transaction(async (manager) => {
            // Find the lot this order created (no lock yet — preserve wallet-before-lot lock order).
            const lotMeta = await manager.findOne(LoyaltyTransaction, {
                where: { orderId, type: 'earn' },
                order: { id: 'DESC' },
            });
            if (lotMeta?.walletId != null) {
                const wallet = await manager.findOne(LoyaltyWallet, {
                    where: { id: lotMeta.walletId },
                    lock: { mode: 'pessimistic_write' },
                });
                const lot = await manager.findOne(LoyaltyTransaction, {
                    where: { id: lotMeta.id },
                    lock: { mode: 'pessimistic_write' },
                });
                // Only the still-unspent remainder can be reversed; spent/expired points are gone.
                const reversible =
                    lot && !lot.expired ? (lot.pointsRemaining ?? 0) : 0;
                if (wallet && reversible > 0) {
                    await manager.save(
                        manager.create(LoyaltyTransaction, {
                            customerId: wallet.customerId,
                            orderId,
                            walletId: wallet.id,
                            walletType: wallet.walletType,
                            brandId: wallet.brandId,
                            points: -reversible,
                            type: 'adjust',
                        }),
                    );
                    await manager.update(LoyaltyWallet, wallet.id, {
                        balance: Math.max(0, wallet.balance - reversible),
                    });
                }
                if (lot) {
                    await manager.update(LoyaltyTransaction, lot.id, {
                        pointsRemaining: 0,
                    });
                }
            }
            await manager.update(Order, orderId, { loyaltyPointsEarned: 0 });
        });
    }

    // ---------------------------------------------------------------------
    // Redeem
    // ---------------------------------------------------------------------

    /**
     * Preview the max redeemable points / discount for an order being placed.
     * Returns null when loyalty is unavailable for this channel/brand/customer.
     */
    async getRedeemPreview(
        tenantId: number,
        customerPhone: string,
        orderTotalAfterOtherDiscounts: number,
        source: string,
        brandId: number | null,
    ): Promise<{
        redeemablePoints: number;
        discountAmount: number;
        displayName: string;
        cashValuePerPoint: number;
        minOrderToRedeem: number;
    } | null> {
        const walletType = mapSourceToWalletType(source);
        if (!walletType) return null;
        const settings = await this.getBrandLoyaltySettings(brandId);
        if (!settings.enabled) return null;
        const normalized = normalizePakistaniPhone(customerPhone);
        if (!normalized) return null;
        const customer = await this.customerRepo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (!customer) return null;
        if (orderTotalAfterOtherDiscounts < settings.minOrderToRedeem)
            return null;

        const brandKey = walletType === 'app' ? null : brandId;
        const wallet = await this.walletRepo.findOne({
            where: {
                customerId: customer.id,
                walletType,
                brandId: walletType === 'app' ? IsNull() : (brandKey as number),
            },
        });
        const balance = wallet?.balance ?? 0;
        const redeemablePoints = Math.min(
            balance,
            Math.floor(
                orderTotalAfterOtherDiscounts / settings.cashValuePerPoint,
            ),
        );
        return {
            redeemablePoints,
            discountAmount: redeemablePoints * settings.cashValuePerPoint,
            displayName: settings.displayName,
            cashValuePerPoint: settings.cashValuePerPoint,
            minOrderToRedeem: settings.minOrderToRedeem,
        };
    }

    /**
     * Redeem points for an order: validate, consume oldest lots first (FIFO),
     * deduct from the wallet, and return the cash discount to apply.
     */
    async redeemForOrder(
        tenantId: number,
        customerPhone: string,
        orderId: number,
        pointsToRedeem: number,
        orderTotalAfterOtherDiscounts: number,
        source: string,
        brandId: number | null,
    ): Promise<{ discountAmount: number }> {
        const walletType = mapSourceToWalletType(source);
        if (!walletType) {
            throw new BadRequestException(
                'Loyalty points are not available for this channel',
            );
        }
        const settings = await this.getBrandLoyaltySettings(brandId);
        if (!settings.enabled) {
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
        if (orderTotalAfterOtherDiscounts < settings.minOrderToRedeem) {
            throw new BadRequestException(
                `Minimum order amount to redeem points is ${settings.minOrderToRedeem}`,
            );
        }

        const brandKey = walletType === 'app' ? null : brandId;
        await this.ensureWalletRow(tenantId, customer.id, walletType, brandKey);

        return this.dataSource.transaction(async (manager) => {
            const wallet = await this.lockWallet(
                manager,
                customer.id,
                walletType,
                brandKey,
            );
            const balance = wallet?.balance ?? 0;
            if (!wallet || pointsToRedeem <= 0 || pointsToRedeem > balance) {
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

            // FIFO: consume the oldest non-expired lots first.
            const lots = await manager
                .createQueryBuilder(LoyaltyTransaction, 'lt')
                .setLock('pessimistic_write')
                .where('lt.walletId = :wid', { wid: wallet.id })
                .andWhere("lt.type = 'earn'")
                .andWhere('lt.expired = false')
                .andWhere('lt.pointsRemaining > 0')
                .andWhere('(lt.expiryDate IS NULL OR lt.expiryDate > now())')
                .orderBy('lt.createdAt', 'ASC')
                .addOrderBy('lt.id', 'ASC')
                .getMany();

            let remaining = pointsToRedeem;
            for (const lot of lots) {
                if (remaining <= 0) break;
                const take = Math.min(lot.pointsRemaining ?? 0, remaining);
                if (take <= 0) continue;
                await manager.update(LoyaltyTransaction, lot.id, {
                    pointsRemaining: (lot.pointsRemaining ?? 0) - take,
                });
                remaining -= take;
            }
            if (remaining > 0) {
                // Cached balance and live lots disagree — refuse rather than over-redeem.
                throw new ConflictException(
                    'Insufficient redeemable points available',
                );
            }

            await manager.save(
                manager.create(LoyaltyTransaction, {
                    customerId: customer.id,
                    orderId,
                    walletId: wallet.id,
                    walletType,
                    brandId: brandKey,
                    points: -pointsToRedeem,
                    type: 'redeem',
                }),
            );
            await manager.update(LoyaltyWallet, wallet.id, {
                balance: balance - pointsToRedeem,
            });
            return { discountAmount };
        });
    }

    // ---------------------------------------------------------------------
    // Balance
    // ---------------------------------------------------------------------

    /**
     * Get a wallet balance (+ display settings) by phone for a given wallet/brand.
     * POS callers pass walletType='pos' + the cart's brand; APP callers pass
     * walletType='app' (shared) with the brand used for display/conversion.
     */
    async getWalletBalance(
        tenantId: number,
        phone: string,
        walletType: WalletType,
        brandId: number | null,
    ): Promise<{
        balance: number;
        displayName: string;
        spendPerPoint: number;
        cashValuePerPoint: number;
        minOrderToEarn: number;
        minOrderToRedeem: number;
    } | null> {
        const settings = await this.getBrandLoyaltySettings(brandId);
        if (!settings.enabled) return null;
        const display = {
            displayName: settings.displayName,
            spendPerPoint: settings.spendPerPoint,
            cashValuePerPoint: settings.cashValuePerPoint,
            minOrderToEarn: settings.minOrderToEarn,
            minOrderToRedeem: settings.minOrderToRedeem,
        };
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return { balance: 0, ...display };
        const customer = await this.customerRepo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (!customer) return { balance: 0, ...display };
        const brandKey = walletType === 'app' ? null : brandId;
        const wallet = await this.walletRepo.findOne({
            where: {
                customerId: customer.id,
                walletType,
                brandId: walletType === 'app' ? IsNull() : (brandKey as number),
            },
        });
        return { balance: wallet?.balance ?? 0, ...display };
    }

    /**
     * Lightweight balance-only lookup for the shared APP wallet (no brand/settings
     * needed). Used where only the number is shown (e.g. order history list).
     */
    async getAppWalletBalance(
        tenantId: number,
        phone: string,
    ): Promise<number> {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return 0;
        const customer = await this.customerRepo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (!customer) return 0;
        const wallet = await this.walletRepo.findOne({
            where: {
                customerId: customer.id,
                walletType: 'app',
                brandId: IsNull(),
            },
        });
        return wallet?.balance ?? 0;
    }
}
