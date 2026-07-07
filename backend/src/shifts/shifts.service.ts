import {
    Injectable,
    NotFoundException,
    ConflictException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from '../entities/shift.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';

@Injectable()
export class ShiftsService {
    constructor(
        @InjectRepository(Shift)
        private repo: Repository<Shift>,
        @InjectRepository(Order)
        private orderRepo: Repository<Order>,
        @InjectRepository(Payment)
        private paymentRepo: Repository<Payment>,
    ) {}

    /** List shifts. When tenantId is set, only shifts for branches belonging to that tenant are returned. When allowedBranchIds is set, only those branches. When allowedBrandIds is set (brand-locked user), only that brand's shifts. */
    async findAll(
        branchId?: number,
        status?: string,
        tenantId?: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
        brandId?: number,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            branchId != null &&
            !allowedBranchIds.includes(branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        if (
            allowedBrandIds != null &&
            brandId != null &&
            !allowedBrandIds.includes(brandId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        const qb = this.repo
            .createQueryBuilder('s')
            .leftJoinAndSelect('s.user', 'u')
            .leftJoinAndSelect('s.branch', 'b')
            .leftJoinAndSelect('s.closer', 'c')
            .leftJoinAndSelect('s.brand', 'shiftBrand')
            .orderBy('s.createdAt', 'DESC');
        if (tenantId != null) {
            qb.innerJoin('b.branchBrands', 'bb').innerJoin(
                'bb.brand',
                'brand',
                'brand.tenantId = :tenantId',
                { tenantId },
            );
        }
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0
        ) {
            qb.andWhere('s.branchId IN (:...allowedBranchIds)', {
                allowedBranchIds,
            });
        }
        if (allowedBrandIds != null) {
            qb.andWhere('s.brandId IN (:...allowedBrandIds)', {
                allowedBrandIds,
            });
        }
        if (branchId) qb.andWhere('s.branchId = :branchId', { branchId });
        if (brandId) qb.andWhere('s.brandId = :brandId', { brandId });
        if (status) qb.andWhere('s.status = :status', { status });
        const list = await qb.getMany();
        const collected = await Promise.all(
            list.map((s) => this.getCollectedAmounts(s)),
        );
        return list.map((s, i) => ({
            ...this.toResponse(s),
            ...collected[i],
        }));
    }

    /** Get one shift by id. When tenantId is set, returns 403 if the shift's branch does not belong to that tenant. When allowedBranchIds is set, 403 if branch not in list. When allowedBrandIds is set, 403 if the shift's brand is not in it. */
    async findOne(
        id: number,
        tenantId?: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        const qb = this.repo
            .createQueryBuilder('s')
            .leftJoinAndSelect('s.user', 'u')
            .leftJoinAndSelect('s.branch', 'b')
            .leftJoinAndSelect('s.closer', 'c')
            .leftJoinAndSelect('s.brand', 'shiftBrand')
            .where('s.id = :id', { id });
        if (tenantId != null) {
            qb.innerJoin('b.branchBrands', 'bb').innerJoin(
                'bb.brand',
                'brand',
                'brand.tenantId = :tenantId',
                { tenantId },
            );
        }
        const shift = await qb.getOne();
        if (!shift) throw new NotFoundException('Shift not found');
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(shift.branchId)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        if (
            allowedBrandIds != null &&
            (shift.brandId == null || !allowedBrandIds.includes(shift.brandId))
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        const collected = await this.getCollectedAmounts(shift);
        return { ...this.toResponse(shift), ...collected };
    }

    async create(
        dto: {
            branch_id: number;
            brand_id: number;
            user_id: number;
            opening_cash: number;
            notes?: string;
        },
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (
            allowedBranchIds != null &&
            Array.isArray(allowedBranchIds) &&
            allowedBranchIds.length > 0 &&
            !allowedBranchIds.includes(dto.branch_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        // Shifts are opened per brand by that brand's staff. Unrestricted
        // users (owner / GM, allowedBrandIds == null) can view and close
        // shifts but never open them.
        if (allowedBrandIds == null) {
            throw new ForbiddenException(
                'Shifts are opened by brand staff. Your account is not locked to a brand.',
            );
        }
        if (!dto.brand_id || !allowedBrandIds.includes(dto.brand_id)) {
            throw new ForbiddenException(
                'You can only open a shift for your own brand',
            );
        }
        const existingOpen = await this.repo.findOne({
            where: {
                branchId: dto.branch_id,
                brandId: dto.brand_id,
                status: 'open',
            },
        });
        if (existingOpen) {
            throw new ConflictException(
                'A shift is already open for this brand at this branch. Close it before opening a new one.',
            );
        }
        const today = new Date().toISOString().slice(0, 10);
        const count = await this.repo
            .createQueryBuilder('s')
            .where('s.branchId = :branchId', { branchId: dto.branch_id })
            .andWhere('date(s.createdAt) = :today', { today })
            .getCount();
        const shiftNumber = `SH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(count + 1).padStart(3, '0')}`;
        const shift = await this.repo.save(
            this.repo.create({
                branchId: dto.branch_id,
                brandId: dto.brand_id,
                userId: dto.user_id,
                shiftNumber,
                openingCash: dto.opening_cash,
                status: 'open',
                openedAt: new Date(),
                notes: dto.notes ?? null,
            }),
        );
        const loaded = await this.repo.findOne({
            where: { id: shift.id },
            relations: ['user', 'branch', 'brand'],
        });
        return this.toResponse(loaded ?? shift);
    }

    /** Get the current open shift for a branch, if any (legacy: any brand). */
    async findOpenByBranch(
        branchId: number,
    ): Promise<{ id: number; shift_number: string; opened_at: string } | null> {
        const shift = await this.repo.findOne({
            where: { branchId, status: 'open' },
            order: { openedAt: 'DESC' },
        });
        if (!shift) return null;
        return {
            id: shift.id,
            shift_number: shift.shiftNumber,
            opened_at:
                shift.openedAt?.toISOString() ?? new Date().toISOString(),
        };
    }

    /** Open shift for a specific brand at a branch, if any. */
    async findOpenByBranchAndBrand(
        branchId: number,
        brandId: number,
    ): Promise<Shift | null> {
        return this.repo.findOne({
            where: { branchId, brandId, status: 'open' },
            order: { openedAt: 'DESC' },
        });
    }

    /** All open shifts at a branch keyed by brand (for the POS till). */
    async findOpenShiftsByBranch(branchId: number): Promise<
        Array<{
            id: number;
            brand_id: number | null;
            shift_number: string;
            opened_at: string;
        }>
    > {
        const shifts = await this.repo.find({
            where: { branchId, status: 'open' },
            order: { openedAt: 'DESC' },
        });
        return shifts.map((s) => ({
            id: s.id,
            brand_id: s.brandId,
            shift_number: s.shiftNumber,
            opened_at: s.openedAt?.toISOString() ?? new Date().toISOString(),
        }));
    }

    /** Branch IDs that currently have an open shift (for POS branch list). */
    async findBranchIdsWithOpenShift(): Promise<number[]> {
        const shifts = await this.repo.find({
            where: { status: 'open' },
            select: ['branchId'],
        });
        const ids = new Set(shifts.map((s) => s.branchId));
        return Array.from(ids);
    }

    /**
     * Sum cash and card collected from payments for completed orders in this shift's branch and time window.
     */
    async getCollectedAmounts(shift: Shift): Promise<{
        cash_collected: number;
        card_collected: number;
    }> {
        const qb = this.paymentRepo
            .createQueryBuilder('p')
            .innerJoin(Order, 'o', 'o.id = p.orderId')
            .where('o.branchId = :branchId', { branchId: shift.branchId })
            .andWhere("o.status = 'completed'")
            .andWhere('o.completedAt >= :openedAt', {
                openedAt: shift.openedAt,
            });
        if (shift.brandId != null) {
            qb.andWhere('o.brandId = :brandId', { brandId: shift.brandId });
        }
        if (shift.closedAt) {
            qb.andWhere('o.completedAt <= :closedAt', {
                closedAt: shift.closedAt,
            });
        }
        const rows = await qb
            .select('p.paymentMethod', 'method')
            .addSelect('SUM(p.amount)', 'total')
            .groupBy('p.paymentMethod')
            .getRawMany<{ method: string; total: string }>();
        let cash_collected = 0;
        let card_collected = 0;
        for (const row of rows) {
            const tot = parseFloat(row.total ?? '0') || 0;
            if (row.method === 'cash') cash_collected = tot;
            else if (row.method === 'card') card_collected = tot;
        }
        return { cash_collected, card_collected };
    }

    /** Add completed order amount to the open shift's expected cash (called when an order is marked completed). Targets the order's brand shift when set. */
    async addCompletedOrderAmount(
        branchId: number,
        amount: number,
        brandId?: number | null,
    ): Promise<void> {
        const shift = await this.repo.findOne({
            where:
                brandId != null
                    ? { branchId, brandId, status: 'open' }
                    : { branchId, status: 'open' },
            order: { openedAt: 'DESC' },
            select: { id: true },
        });
        if (!shift) return;
        // Atomic increment scoped to the still-open shift row. Avoids the
        // read-modify-write lost update when two orders complete concurrently, and
        // the `status = 'open'` guard means a shift closed in the meantime is left
        // untouched (0 rows affected) rather than resurrected by a full-entity save.
        await this.repo
            .createQueryBuilder()
            .update(Shift)
            .set({
                expectedCash: () =>
                    'COALESCE(expected_cash, opening_cash) + :amount',
            })
            .where('id = :id AND status = :open', {
                id: shift.id,
                open: 'open',
            })
            .setParameter('amount', amount)
            .execute();
    }

    async close(
        id: number,
        dto: { actual_cash: number; notes?: string },
        tenantId?: number | null,
        allowedBranchIds?: number[] | null,
        closedByUserId?: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (tenantId != null) {
            await this.findOne(id, tenantId, allowedBranchIds, allowedBrandIds);
        }
        // Atomic close: only the caller that flips open -> closed wins. A concurrent
        // double-close (double-click, or GM + cashier) affects 0 rows and gets a
        // clean 409 instead of silently overwriting the first close's reconciliation
        // figures. Using a scoped UPDATE (not a full-entity save) also means a
        // completion increment racing this close cannot revert it.
        const res = await this.repo
            .createQueryBuilder()
            .update(Shift)
            .set({
                closingCash: dto.actual_cash,
                status: 'closed',
                closedAt: () => 'now()',
                closedByUserId: closedByUserId ?? null,
                expectedCash: () => 'COALESCE(expected_cash, opening_cash)',
                ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
            })
            .where('id = :id AND status = :open', { id, open: 'open' })
            .execute();
        if (res.affected === 0) {
            const exists = await this.repo.findOne({
                where: { id },
                select: { id: true },
            });
            if (!exists) throw new NotFoundException('Shift not found');
            throw new ConflictException('Shift is already closed');
        }
        const loaded = await this.repo.findOne({
            where: { id },
            relations: ['user', 'branch', 'closer', 'brand'],
        });
        if (!loaded) throw new NotFoundException('Shift not found');
        return this.toResponse(loaded);
    }

    /**
     * Completed orders during this shift's branch + time window, with per-order
     * payment method and aggregate cash/card subtotals — for the close-shift review.
     */
    async getOrdersInShift(
        id: number,
        tenantId?: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        // findOne enforces tenant/branch/brand access (throws 403/404) and
        // already returns the shift's window + cash/card collected — reuse
        // both rather than re-querying the shift and re-running the aggregate.
        const access = await this.findOne(
            id,
            tenantId,
            allowedBranchIds,
            allowedBrandIds,
        );
        const openedAt = new Date(access.opened_at);

        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.payments', 'p')
            .where('o.branchId = :branchId', { branchId: access.branch_id })
            .andWhere("o.status = 'completed'")
            .andWhere('o.completedAt >= :openedAt', { openedAt })
            .orderBy('o.completedAt', 'DESC');
        if (access.brand_id != null) {
            qb.andWhere('o.brandId = :shiftBrandId', {
                shiftBrandId: access.brand_id,
            });
        }
        if (access.closed_at) {
            qb.andWhere('o.completedAt <= :closedAt', {
                closedAt: new Date(access.closed_at),
            });
        }
        const orders = await qb.getMany();
        const serialized = orders.map((o) => {
            const methods = Array.from(
                new Set(
                    (o.payments ?? []).map((p: Payment) => p.paymentMethod),
                ),
            );
            return {
                id: o.id,
                order_number: o.orderNumber,
                total_amount: Number(o.totalAmount),
                completed_at: o.completedAt
                    ? o.completedAt.toISOString()
                    : null,
                status: o.status,
                payment_method: methods.length ? methods.join(' + ') : null,
                customer_name: o.customerName ?? null,
            };
        });
        return {
            shift_id: id,
            order_count: serialized.length,
            total_amount: serialized.reduce(
                (sum, o) => sum + o.total_amount,
                0,
            ),
            cash_collected: access.cash_collected,
            card_collected: access.card_collected,
            orders: serialized,
        };
    }

    private toResponse(s: Shift) {
        return {
            id: s.id,
            branch_id: s.branchId,
            brand_id: s.brandId ?? null,
            brand: s.brand ? { id: s.brand.id, name: s.brand.name } : null,
            user_id: s.userId,
            shift_number: s.shiftNumber,
            opening_cash: Number(s.openingCash),
            expected_cash:
                s.expectedCash != null ? Number(s.expectedCash) : null,
            actual_cash: s.closingCash != null ? Number(s.closingCash) : null,
            difference:
                s.closingCash != null && s.expectedCash != null
                    ? Number(s.closingCash) - Number(s.expectedCash)
                    : null,
            status: s.status,
            opened_at: s.openedAt?.toISOString() ?? null,
            closed_at: s.closedAt?.toISOString() ?? null,
            closed_by_user_id: s.closedByUserId ?? null,
            notes: s.notes ?? null,
            user: (s as { user?: { id: number; name: string; email: string } })
                .user
                ? {
                      id: (s as { user: { id: number } }).user.id,
                      name: (s as { user: { name: string } }).user.name,
                      email: (s as { user: { email: string } }).user.email,
                  }
                : null,
            closer: (
                s as {
                    closer?: { id: number; name: string; email: string };
                }
            ).closer
                ? {
                      id: (s as { closer: { id: number } }).closer.id,
                      name: (s as { closer: { name: string } }).closer.name,
                      email: (s as { closer: { email: string } }).closer.email,
                  }
                : null,
            branch: (
                s as { branch?: { id: number; name: string; code: string } }
            ).branch
                ? {
                      id: (s as { branch: { id: number } }).branch.id,
                      name: (s as { branch: { name: string } }).branch.name,
                      code: (s as { branch: { code: string } }).branch.code,
                  }
                : null,
        };
    }
}
