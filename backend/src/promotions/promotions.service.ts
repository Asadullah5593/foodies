import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    Repository,
    LessThanOrEqual,
    MoreThanOrEqual,
    IsNull,
    Or,
} from 'typeorm';
import { Promotion } from '../entities/promotion.entity';
import { CustomerPromotion } from '../entities/customer-promotion.entity';
import { Discount } from '../entities/discount.entity';

@Injectable()
export class PromotionsService {
    private readonly logger = new Logger(PromotionsService.name);

    constructor(
        @InjectRepository(Promotion)
        private promoRepo: Repository<Promotion>,
        @InjectRepository(CustomerPromotion)
        private cpRepo: Repository<CustomerPromotion>,
        @InjectRepository(Discount)
        private discountRepo: Repository<Discount>,
    ) {}

    async findAll(tenantId: number) {
        const list = await this.promoRepo.find({
            where: { tenantId },
            order: { createdAt: 'DESC' },
        });
        return list.map((p) => this.toPromoResponse(p));
    }

    async findOne(id: number, tenantId: number) {
        const p = await this.promoRepo.findOne({ where: { id, tenantId } });
        if (!p) throw new NotFoundException('Promotion not found');
        return this.toPromoResponse(p);
    }

    async create(
        tenantId: number,
        dto: {
            name: string;
            description?: string;
            image_url?: string;
            promotion_type: string;
            discount_type?: string;
            discount_value?: number;
            free_menu_item_id?: number;
            eligibility_type?: string;
            is_active?: boolean;
            expires_in_days?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        const name = String(dto.name ?? '').trim();
        if (!name) throw new BadRequestException('Name is required');

        const promotionType = dto.promotion_type;
        if (promotionType !== 'discount' && promotionType !== 'free_item') {
            throw new BadRequestException(
                'promotion_type must be "discount" or "free_item"',
            );
        }
        if (promotionType === 'discount') {
            if (
                !dto.discount_type ||
                !['flat', 'percentage'].includes(dto.discount_type)
            ) {
                throw new BadRequestException(
                    'discount_type must be "flat" or "percentage" for discount promotions',
                );
            }
            if (dto.discount_value == null || Number(dto.discount_value) < 0) {
                throw new BadRequestException(
                    'discount_value is required for discount promotions',
                );
            }
        }
        if (promotionType === 'free_item') {
            if (!dto.free_menu_item_id) {
                throw new BadRequestException(
                    'free_menu_item_id is required for free_item promotions',
                );
            }
        }

        const eligibilityType = dto.eligibility_type ?? 'new_customer';
        if (!['new_customer', 'manual'].includes(eligibilityType)) {
            throw new BadRequestException(
                'eligibility_type must be "new_customer" or "manual"',
            );
        }

        const p = await this.promoRepo.save(
            this.promoRepo.create({
                tenantId,
                name,
                description: dto.description?.trim() || null,
                imageUrl: dto.image_url?.trim() || null,
                promotionType,
                discountType:
                    promotionType === 'discount' ? dto.discount_type! : null,
                discountValue:
                    promotionType === 'discount'
                        ? Number(dto.discount_value)
                        : null,
                freeMenuItemId:
                    promotionType === 'free_item'
                        ? dto.free_menu_item_id!
                        : null,
                eligibilityType,
                isActive: dto.is_active ?? true,
                expiresInDays: dto.expires_in_days ?? null,
                validFrom: dto.valid_from ? new Date(dto.valid_from) : null,
                validUntil: dto.valid_until ? new Date(dto.valid_until) : null,
            }),
        );
        return this.toPromoResponse(p);
    }

    async update(
        id: number,
        tenantId: number,
        dto: {
            name?: string;
            description?: string;
            image_url?: string;
            is_active?: boolean;
            expires_in_days?: number;
            valid_from?: string;
            valid_until?: string;
        },
    ) {
        const p = await this.promoRepo.findOne({ where: { id, tenantId } });
        if (!p) throw new NotFoundException('Promotion not found');
        const wasActive = p.isActive;

        if (dto.name !== undefined) {
            const n = String(dto.name).trim();
            if (!n) throw new BadRequestException('Name cannot be empty');
            p.name = n;
        }
        if (dto.description !== undefined)
            p.description = dto.description?.trim() || null;
        if (dto.image_url !== undefined)
            p.imageUrl = dto.image_url?.trim() || null;
        if (dto.is_active !== undefined) p.isActive = dto.is_active;
        if (dto.expires_in_days !== undefined)
            p.expiresInDays = dto.expires_in_days ?? null;
        if (dto.valid_from !== undefined)
            p.validFrom = dto.valid_from ? new Date(dto.valid_from) : null;
        if (dto.valid_until !== undefined)
            p.validUntil = dto.valid_until ? new Date(dto.valid_until) : null;

        await this.promoRepo.save(p);
        // Switching a promotion off tears down its outstanding customer copies.
        if (wasActive && !p.isActive) {
            await this.deactivateAssignments(p.id);
        }
        return this.toPromoResponse(p);
    }

    /**
     * When a promotion is switched off, remove its outstanding customer copies:
     * expire the ones not yet claimed, and disable the coupon/discount generated by
     * any already-claimed copy so it can no longer be redeemed. Copies already
     * 'used' are left untouched to preserve redemption history.
     */
    private async deactivateAssignments(promotionId: number): Promise<void> {
        const copies = await this.cpRepo.find({ where: { promotionId } });
        const now = new Date();
        for (const cp of copies) {
            if (cp.status === 'pending') {
                cp.status = 'expired';
                if (cp.expiresAt == null) cp.expiresAt = now;
                await this.cpRepo.save(cp);
            } else if (cp.status === 'claimed') {
                if (cp.discountId != null) {
                    await this.discountRepo.update(
                        { id: cp.discountId },
                        { isActive: false },
                    );
                }
                cp.status = 'expired';
                await this.cpRepo.save(cp);
            }
        }
    }

    async remove(id: number, tenantId: number) {
        const p = await this.promoRepo.findOne({ where: { id, tenantId } });
        if (!p) throw new NotFoundException('Promotion not found');
        await this.promoRepo.remove(p);
        return { message: 'Promotion deleted successfully' };
    }

    /** Consumer API: list a customer's assigned promotions, optionally filtered by status */
    async getCustomerPromotions(customerId: number, status?: string) {
        const where: Record<string, unknown> = { customerId };
        if (status) where['status'] = status;

        const list = await this.cpRepo.find({
            where,
            relations: ['promotion'],
            order: { assignedAt: 'DESC' },
        });

        // Mark expired ones on read
        const now = new Date();
        const result = [];
        for (const cp of list) {
            if (cp.status === 'pending' && cp.expiresAt && cp.expiresAt < now) {
                cp.status = 'expired';
                await this.cpRepo.save(cp);
            }
            result.push(this.toCpResponse(cp));
        }
        return result;
    }

    /** Consumer API: claim a pending promotion, generating a coupon code */
    async claimPromotion(customerPromotionId: number, customerId: number) {
        const cp = await this.cpRepo.findOne({
            where: { id: customerPromotionId, customerId },
            relations: ['promotion'],
        });
        if (!cp) throw new NotFoundException('Promotion not found');
        if (cp.status === 'claimed')
            throw new BadRequestException('Promotion already claimed');
        if (cp.status === 'used')
            throw new BadRequestException('Promotion has already been used');
        if (
            cp.status === 'expired' ||
            (cp.expiresAt && cp.expiresAt < new Date())
        ) {
            cp.status = 'expired';
            await this.cpRepo.save(cp);
            throw new BadRequestException('Promotion has expired');
        }
        if (cp.status !== 'pending')
            throw new BadRequestException('Promotion cannot be claimed');

        const promo = cp.promotion;

        // Build discount record
        let discountType: string;
        let discountValue: number;
        let applicationScope = 'whole_order';
        let applicationScopeIds: number[] | null = null;

        if (promo.promotionType === 'free_item') {
            discountType = 'percentage';
            discountValue = 100;
            applicationScope = 'products';
            applicationScopeIds = [promo.freeMenuItemId!];
        } else {
            discountType = promo.discountType!;
            discountValue = Number(promo.discountValue);
        }

        const code = await this.generateCouponCode(
            promo.name,
            discountType,
            discountValue,
        );
        const discount = await this.discountRepo.save(
            this.discountRepo.create({
                tenantId: promo.tenantId,
                name: promo.name,
                type: discountType,
                value: discountValue,
                requiresCode: true,
                code,
                applicationScope,
                applicationScopeIds,
                isActive: true,
                validUntil: cp.expiresAt ?? undefined,
            }),
        );

        cp.couponCode = code;
        cp.discountId = discount.id;
        cp.claimedAt = new Date();
        cp.status = 'claimed';
        await this.cpRepo.save(cp);

        return {
            coupon_code: code,
            discount_id: discount.id,
            expires_at: cp.expiresAt?.toISOString() ?? null,
            promotion: this.toPromoResponse(promo),
        };
    }

    /**
     * Called (fire-and-forget) after a new customer is created.
     * Assigns all active new_customer promotions for the tenant.
     */
    async assignNewCustomerPromotions(
        tenantId: number,
        customerId: number,
    ): Promise<void> {
        const now = new Date();
        const promotions = await this.promoRepo.find({
            where: {
                tenantId,
                eligibilityType: 'new_customer',
                isActive: true,
            },
        });

        const eligible = promotions.filter(
            (p) =>
                (p.validFrom == null || p.validFrom <= now) &&
                (p.validUntil == null || p.validUntil >= now),
        );

        for (const promo of eligible) {
            try {
                const expiresAt =
                    promo.expiresInDays != null
                        ? new Date(
                              now.getTime() +
                                  promo.expiresInDays * 24 * 60 * 60 * 1000,
                          )
                        : null;
                await this.cpRepo.save(
                    this.cpRepo.create({
                        customerId,
                        promotionId: promo.id,
                        status: 'pending',
                        expiresAt,
                    }),
                );
            } catch (err: unknown) {
                const e = err as { code?: string };
                if (e?.code === '23505') continue; // already assigned
                this.logger.warn(
                    `Failed to assign promotion ${promo.id} to customer ${customerId}`,
                    err,
                );
            }
        }
    }

    /** Admin: manually assign a promotion to a specific customer */
    async manualAssign(
        promotionId: number,
        customerId: number,
        tenantId: number,
    ) {
        const promo = await this.promoRepo.findOne({
            where: { id: promotionId, tenantId },
        });
        if (!promo) throw new NotFoundException('Promotion not found');
        if (promo.eligibilityType !== 'manual') {
            throw new BadRequestException(
                'Only manual eligibility promotions can be manually assigned',
            );
        }

        const now = new Date();
        const expiresAt =
            promo.expiresInDays != null
                ? new Date(
                      now.getTime() + promo.expiresInDays * 24 * 60 * 60 * 1000,
                  )
                : null;

        try {
            const cp = await this.cpRepo.save(
                this.cpRepo.create({
                    customerId,
                    promotionId,
                    status: 'pending',
                    expiresAt,
                }),
            );
            return this.toCpResponse(cp);
        } catch (err: unknown) {
            const e = err as { code?: string };
            if (e?.code === '23505') {
                throw new BadRequestException(
                    'Customer is already assigned this promotion',
                );
            }
            throw err;
        }
    }

    /** Admin: list assignments for a promotion */
    async getAssignments(promotionId: number, tenantId: number) {
        const promo = await this.promoRepo.findOne({
            where: { id: promotionId, tenantId },
        });
        if (!promo) throw new NotFoundException('Promotion not found');

        const list = await this.cpRepo.find({
            where: { promotionId },
            order: { assignedAt: 'DESC' },
        });
        return list.map((cp) => this.toCpResponse(cp));
    }

    private async generateCouponCode(
        name: string,
        type: string,
        value: number,
    ): Promise<string> {
        const slug = name
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 8);
        const valuePart = Math.round(Number(value)).toString();
        let base = slug ? `${slug}${valuePart}` : `PROMO${valuePart}`;
        if (base.length > 12) base = base.slice(0, 12);
        let code = base;
        let suffix = 1;
        while (await this.discountRepo.findOne({ where: { code } })) {
            code = `${base}${suffix}`;
            suffix += 1;
            if (code.length > 15) code = `${base.slice(0, 10)}${suffix}`;
        }
        return code;
    }

    private toPromoResponse(p: Promotion) {
        return {
            id: p.id,
            tenant_id: p.tenantId,
            name: p.name,
            description: p.description,
            image_url: p.imageUrl,
            promotion_type: p.promotionType,
            discount_type: p.discountType,
            discount_value:
                p.discountValue != null ? Number(p.discountValue) : null,
            free_menu_item_id: p.freeMenuItemId,
            eligibility_type: p.eligibilityType,
            is_active: p.isActive,
            expires_in_days: p.expiresInDays,
            valid_from: p.validFrom?.toISOString() ?? null,
            valid_until: p.validUntil?.toISOString() ?? null,
            created_at: p.createdAt?.toISOString() ?? null,
        };
    }

    private toCpResponse(cp: CustomerPromotion) {
        return {
            id: cp.id,
            customer_id: cp.customerId,
            promotion_id: cp.promotionId,
            coupon_code: cp.couponCode,
            discount_id: cp.discountId,
            status: cp.status,
            assigned_at: cp.assignedAt?.toISOString() ?? null,
            expires_at: cp.expiresAt?.toISOString() ?? null,
            claimed_at: cp.claimedAt?.toISOString() ?? null,
            used_at: cp.usedAt?.toISOString() ?? null,
            promotion: cp.promotion
                ? this.toPromoResponse(cp.promotion)
                : undefined,
        };
    }
}
