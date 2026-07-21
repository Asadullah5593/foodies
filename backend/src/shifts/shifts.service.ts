import {
    Injectable,
    NotFoundException,
    ConflictException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
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
        openedFrom?: Date | null,
        openedTo?: Date | null,
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
        // Range pruning: only shifts OPENED inside the window — but open shifts
        // are always returned regardless, so a drawer still running from before
        // the window (e.g. last night) can never be filtered out of sight.
        if (openedFrom && openedTo) {
            qb.andWhere(
                new Brackets((w) =>
                    w
                        .where('s.openedAt BETWEEN :openedFrom AND :openedTo', {
                            openedFrom,
                            openedTo,
                        })
                        .orWhere("s.status = 'open'"),
                ),
            );
        }
        const list = await qb.getMany();
        const collected = await this.getCollectedAmountsBatch(list);
        // Open shifts derive their expected cash; closed ones keep the value
        // frozen at close.
        const expected = new Map<number, number>();
        for (const s of list.filter((x) => x.status === 'open')) {
            expected.set(
                s.id,
                await this.computeExpectedCash(
                    s,
                    collected.get(s.id)?.cash_collected ?? 0,
                ),
            );
        }
        return list.map((s) => ({
            ...this.toResponse(s, expected.get(s.id)),
            ...(collected.get(s.id) ?? {
                cash_collected: 0,
                card_collected: 0,
            }),
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
        const expected =
            shift.status === 'open'
                ? await this.computeExpectedCash(
                      shift,
                      collected.cash_collected,
                  )
                : undefined;
        return { ...this.toResponse(shift, expected), ...collected };
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
    /**
     * Collected amounts for MANY shifts in one grouped query — replaces the
     * per-shift N+1 that findAll used to run. Matching rule is identical to
     * getCollectedAmounts: completed orders of the shift's branch (and brand,
     * when set) whose completion falls inside the shift's open window.
     */
    private async getCollectedAmountsBatch(
        shifts: Shift[],
    ): Promise<
        Map<number, { cash_collected: number; card_collected: number }>
    > {
        const out = new Map<
            number,
            { cash_collected: number; card_collected: number }
        >();
        for (const s of shifts)
            out.set(s.id, { cash_collected: 0, card_collected: 0 });
        if (shifts.length === 0) return out;
        const rows = await this.paymentRepo
            .createQueryBuilder('p')
            .innerJoin(Order, 'o', 'o.id = p.orderId')
            .innerJoin(
                Shift,
                's',
                's.branchId = o.branchId' +
                    ' AND o.completedAt >= s.openedAt' +
                    ' AND (s.closedAt IS NULL OR o.completedAt <= s.closedAt)' +
                    ' AND (s.brandId IS NULL OR o.brandId = s.brandId)',
            )
            .where('s.id IN (:...ids)', { ids: shifts.map((s) => s.id) })
            .andWhere("o.status = 'completed'")
            .select('s.id', 'shift_id')
            .addSelect('p.paymentMethod', 'method')
            .addSelect('SUM(p.amount)', 'total')
            .groupBy('s.id')
            .addGroupBy('p.paymentMethod')
            .getRawMany<{ shift_id: number; method: string; total: string }>();
        for (const row of rows) {
            const entry = out.get(Number(row.shift_id));
            if (!entry) continue;
            const tot = parseFloat(row.total ?? '0') || 0;
            if (row.method === 'cash') entry.cash_collected = tot;
            else if (row.method === 'card') entry.card_collected = tot;
        }
        return out;
    }

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

    /**
     * Balance of completed orders in the shift window that nobody has tendered.
     *
     * There is no online payment anywhere in the system, so an order that
     * completed without a payment row was settled in cash at the door — money a
     * rider is carrying and owes the till. Counting it here is what makes a
     * rider who never hands the cash over show up as a shortfall at close.
     *
     * Same matching rule as getCollectedAmounts: completed orders of the
     * shift's branch (and brand, when set) whose completion falls in the window.
     */
    private outstandingQb(shift: Shift) {
        const qb = this.orderRepo
            .createQueryBuilder('o')
            .leftJoin(
                (sub) =>
                    sub
                        .select('p.orderId', 'order_id')
                        .addSelect('SUM(p.amount)', 'paid')
                        .from(Payment, 'p')
                        .groupBy('p.orderId'),
                'pay',
                'pay.order_id = o.id',
            )
            .where('o.branchId = :branchId', { branchId: shift.branchId })
            .andWhere("o.status = 'completed'")
            .andWhere('o.completedAt >= :openedAt', {
                openedAt: shift.openedAt,
            });
        if (shift.brandId != null)
            qb.andWhere('o.brandId = :brandId', { brandId: shift.brandId });
        if (shift.closedAt)
            qb.andWhere('o.completedAt <= :closedAt', {
                closedAt: shift.closedAt,
            });
        return qb;
    }

    /** Untendered balance of the shift's completed orders (never negative). */
    private async getOutstandingTotal(shift: Shift): Promise<number> {
        const row = await this.outstandingQb(shift)
            .select(
                'COALESCE(SUM(GREATEST(o.total_amount - COALESCE(pay.paid, 0), 0)), 0)',
                'outstanding',
            )
            .getRawOne<{ outstanding: string }>();
        return parseFloat(row?.outstanding ?? '0') || 0;
    }

    /**
     * Cash the till should hold: what it opened with, every cash tender taken
     * during the shift, and the untendered balance the riders are carrying.
     * Derived on read for open shifts; closed shifts keep the value frozen at
     * close, because orders completed before this existed never recorded a
     * tender and recomputing them could not be more truthful.
     */
    private async computeExpectedCash(
        shift: Shift,
        cashCollected: number,
    ): Promise<number> {
        const outstanding = await this.getOutstandingTotal(shift);
        return Number(shift.openingCash ?? 0) + cashCollected + outstanding;
    }

    /**
     * Expected cash used to be accrued here on every completion, which counted
     * card sales as cash and never reversed when an order left `completed`. It
     * is now derived from the tenders themselves (computeExpectedCash), so
     * nothing needs to be incremented as orders finish.
     */

    /**
     * Orders punched during this shift (branch + brand + opened-at window) that
     * are still in a non-terminal status. They block closing the shift: staff
     * must complete (or cancel) each one first. Cancelled orders are terminal
     * and never block.
     */
    async getPendingOrdersInShift(
        id: number,
        tenantId?: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        // findOne enforces tenant/branch/brand access (throws 403/404).
        const access = await this.findOne(
            id,
            tenantId,
            allowedBranchIds,
            allowedBrandIds,
        );
        const orders = await this.pendingOrdersQb(
            access.branch_id,
            access.brand_id,
            new Date(access.opened_at),
        )
            .leftJoinAndSelect('o.brand', 'brand')
            .orderBy('o.createdAt', 'ASC')
            .getMany();
        return {
            shift_id: id,
            pending_count: orders.length,
            orders: orders.map((o) => ({
                id: o.id,
                order_number: o.orderNumber,
                status: o.status,
                order_type: o.orderType,
                total_amount: Number(o.totalAmount),
                customer_name: o.customerName ?? null,
                table_number: o.tableNumber ?? null,
                brand_name: o.brand?.name ?? null,
                placed_at: (o.placedAt ?? o.createdAt)?.toISOString() ?? null,
            })),
        };
    }

    /** Non-terminal orders of a shift's branch/brand punched since it opened. */
    private pendingOrdersQb(
        branchId: number,
        brandId: number | null,
        openedAt: Date,
    ) {
        const qb = this.orderRepo
            .createQueryBuilder('o')
            .where('o.branchId = :branchId', { branchId })
            .andWhere("o.status NOT IN ('completed', 'cancelled')")
            .andWhere('o.createdAt >= :openedAt', { openedAt });
        if (brandId != null) qb.andWhere('o.brandId = :brandId', { brandId });
        return qb;
    }

    async close(
        id: number,
        dto: { actual_cash: number; rider_cash?: number; notes?: string },
        tenantId?: number | null,
        allowedBranchIds?: number[] | null,
        closedByUserId?: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (tenantId != null) {
            await this.findOne(id, tenantId, allowedBranchIds, allowedBrandIds);
        }
        // A shift only closes once every order punched during it has reached a
        // terminal status — otherwise its reconciliation (expected cash, sales)
        // would silently exclude the stragglers. The UI surfaces this list with
        // one-click completion; this guard is the actual enforcement.
        const shift = await this.repo.findOne({ where: { id } });
        if (!shift) throw new NotFoundException('Shift not found');
        if (shift.status === 'open' && shift.openedAt) {
            const pending = await this.pendingOrdersQb(
                shift.branchId,
                shift.brandId ?? null,
                shift.openedAt,
            ).getCount();
            if (pending > 0) {
                throw new ConflictException(
                    `${pending} order${pending === 1 ? ' is' : 's are'} still not completed for this shift. Complete or cancel them before closing.`,
                );
            }
        }
        // Atomic close: only the caller that flips open -> closed wins. A concurrent
        // double-close (double-click, or GM + cashier) affects 0 rows and gets a
        // clean 409 instead of silently overwriting the first close's reconciliation
        // figures. Using a scoped UPDATE (not a full-entity save) also means a
        // completion increment racing this close cannot revert it.
        // Freeze the derived figure at close: from here on this shift is a
        // historical record and must not drift if an old order is touched later.
        const { cash_collected } = await this.getCollectedAmounts(shift);
        const expectedAtClose = await this.computeExpectedCash(
            shift,
            cash_collected,
        );
        const riderCash =
            dto.rider_cash != null && Number.isFinite(Number(dto.rider_cash))
                ? Number(dto.rider_cash)
                : 0;
        const res = await this.repo
            .createQueryBuilder()
            .update(Shift)
            .set({
                closingCash: dto.actual_cash,
                riderCashCollected: riderCash,
                status: 'closed',
                closedAt: () => 'now()',
                closedByUserId: closedByUserId ?? null,
                expectedCash: expectedAtClose,
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

    /**
     * @param expectedOverride derived expected cash for an open shift. Closed
     * shifts pass nothing and keep the value frozen at close.
     */
    private toResponse(s: Shift, expectedOverride?: number) {
        const expected =
            expectedOverride !== undefined
                ? expectedOverride
                : s.expectedCash != null
                  ? Number(s.expectedCash)
                  : null;
        const riderCash =
            s.riderCashCollected != null ? Number(s.riderCashCollected) : null;
        // Actual cash is the drawer count plus whatever the riders handed in.
        const actual =
            s.closingCash != null
                ? Number(s.closingCash) + (riderCash ?? 0)
                : null;
        return {
            id: s.id,
            branch_id: s.branchId,
            brand_id: s.brandId ?? null,
            brand: s.brand ? { id: s.brand.id, name: s.brand.name } : null,
            user_id: s.userId,
            shift_number: s.shiftNumber,
            opening_cash: Number(s.openingCash),
            expected_cash: expected,
            /** Money counted in the drawer, excluding rider cash. */
            drawer_cash: s.closingCash != null ? Number(s.closingCash) : null,
            /** Cash riders handed to the till, entered at close. */
            rider_cash_collected: riderCash,
            actual_cash: actual,
            difference: actual != null && expected != null ? actual - expected : null,
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
