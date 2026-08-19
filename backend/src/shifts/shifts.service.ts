import {
    Injectable,
    NotFoundException,
    ConflictException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { Shift } from '../entities/shift.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';
import { BranchBrand } from '../entities/branch-brand.entity';
import { ActivityContext } from '../activity-log/activity-context';

/**
 * Round to whole paisa. The module used to only ADD already-2dp figures, so it
 * never needed this; subtracting a cash-out introduces binary-float drift
 * (5000 + 90622.24 − 45000 = 50622.240000000005), which would otherwise be
 * frozen into expected_cash at close and shown in the API.
 */
const round2 = (n: number): number =>
    Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Closing is opener-only: the drawer belongs to whoever counted it open, so
 * another cashier may not reconcile it. `shifts:override` holders (owner, GM,
 * branch managers, brand admins) close on the opener's behalf — the shift still
 * records them as the closer.
 */
export function assertShiftCloseAllowed(
    openerUserId: number,
    closerUserId: number | null | undefined,
    canOverride: boolean,
): void {
    if (canOverride) return;
    if (closerUserId != null && closerUserId === openerUserId) return;
    throw new ForbiddenException(
        'Only the user who opened this shift can close it.',
    );
}

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
        // Cash-outs are shown for closed shifts too (their frozen expected is
        // already net of them, and the reconciliation ladder has to add up).
        const cashOuts = await this.getCashOutTotalsBatch(list);
        // Open shifts derive their expected cash; closed ones keep the value
        // frozen at close.
        const expected = new Map<number, number>();
        for (const s of list.filter((x) => x.status === 'open')) {
            expected.set(
                s.id,
                this.computeExpectedCash(
                    s,
                    collected.get(s.id)?.cash_collected ?? 0,
                    cashOuts.get(s.id) ?? 0,
                ),
            );
        }
        return list.map((s) => ({
            ...this.toResponse(s, expected.get(s.id), cashOuts.get(s.id) ?? 0),
            ...(collected.get(s.id) ?? {
                cash_collected: 0,
                card_collected: 0,
                online_transfer_collected: 0,
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
        const cashOutTotal = await this.getCashOutTotal(shift.id);
        const expected =
            shift.status === 'open'
                ? this.computeExpectedCash(
                      shift,
                      collected.cash_collected,
                      cashOutTotal,
                  )
                : undefined;
        return {
            ...this.toResponse(shift, expected, cashOutTotal),
            ...collected,
        };
    }

    async create(
        dto: {
            branch_id: number;
            brand_id: number;
            user_id: number;
            opening_cash: number;
            notes?: string;
        },
        tenantId: number,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
        canOverride = false,
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
        // An empty allowedBranchIds means a tenant-level role with zero branch
        // assignments and no all-branches:access. Elsewhere [] reads as
        // unrestricted, which was harmless while such users could never open;
        // with shifts:override in play it would mean tenant-wide opens, so
        // opening requires an actual branch assignment (or all-branches).
        if (Array.isArray(allowedBranchIds) && allowedBranchIds.length === 0) {
            throw new ForbiddenException('You are not assigned to any branch');
        }
        // Shifts are opened per brand by that brand's staff. Unrestricted
        // users (owner / GM, allowedBrandIds == null) can view and close
        // shifts but never open them — unless they hold shifts:override,
        // which lets a supervisor open for any brand at any of their branches.
        if (allowedBrandIds == null) {
            if (!canOverride) {
                throw new ForbiddenException(
                    'Shifts are opened by brand staff. Your account is not locked to a brand.',
                );
            }
        } else if (!dto.brand_id || !allowedBrandIds.includes(dto.brand_id)) {
            // Brand-locked users (override or not) stay pinned to their brand.
            throw new ForbiddenException(
                'You can only open a shift for your own brand',
            );
        }
        // The chosen brand must be served at the chosen branch and belong to
        // the caller's tenant. For brand-locked staff their lock implied this;
        // for override users this IS the tenant boundary — without it an
        // unrestricted admin could open a shift on another tenant's branch.
        if (!dto.brand_id) {
            throw new ForbiddenException('brand_id is required');
        }
        const link = await this.repo.manager
            .createQueryBuilder(BranchBrand, 'bb')
            .innerJoin('bb.brand', 'brand', 'brand.tenantId = :tenantId', {
                tenantId,
            })
            .where('bb.branchId = :branchId AND bb.brandId = :brandId', {
                branchId: dto.branch_id,
                brandId: dto.brand_id,
            })
            .getOne();
        if (!link) {
            throw new ForbiddenException(
                'This brand is not available at this branch',
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
    private async getCollectedAmountsBatch(shifts: Shift[]): Promise<
        Map<
            number,
            {
                cash_collected: number;
                card_collected: number;
                online_transfer_collected: number;
            }
        >
    > {
        const out = new Map<
            number,
            {
                cash_collected: number;
                card_collected: number;
                online_transfer_collected: number;
            }
        >();
        for (const s of shifts)
            out.set(s.id, {
                cash_collected: 0,
                card_collected: 0,
                online_transfer_collected: 0,
            });
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
            // Its own bucket on purpose: an online transfer is taxed like a
            // card but reconciles like neither, and merging it into card would
            // hide it from the person counting the till.
            else if (row.method === 'online_transfer')
                entry.online_transfer_collected = tot;
        }
        return out;
    }

    async getCollectedAmounts(shift: Shift): Promise<{
        cash_collected: number;
        card_collected: number;
        online_transfer_collected: number;
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
        let online_transfer_collected = 0;
        for (const row of rows) {
            const tot = parseFloat(row.total ?? '0') || 0;
            if (row.method === 'cash') cash_collected = tot;
            else if (row.method === 'card') card_collected = tot;
            else if (row.method === 'online_transfer')
                online_transfer_collected = tot;
        }
        return { cash_collected, card_collected, online_transfer_collected };
    }

    /**
     * Cash the till should hold: what it opened with, plus every cash tender it
     * took, minus anything handed out mid-shift (cash-outs). Money riders are
     * carrying is deliberately NOT counted — the till reconciles only on cash
     * that physically passed through it.
     *
     * Derived on read for open shifts; closed shifts keep the value frozen at
     * close, because orders completed before this existed never recorded a
     * tender and recomputing them could not be more truthful.
     *
     * No clamping: a drop larger than the takings is a real negative
     * expectation, not an error to hide.
     */
    private computeExpectedCash(
        shift: Shift,
        cashCollected: number,
        cashOutTotal: number,
    ): number {
        return round2(
            Number(shift.openingCash ?? 0) +
                Number(cashCollected) -
                Number(cashOutTotal),
        );
    }

    /**
     * Total handed out of this till mid-shift. Voided entries never count.
     * Summed in SQL over numeric(12,2) so the arithmetic stays exact; `manager`
     * lets the close read it inside its own locked transaction.
     */
    private async getCashOutTotal(
        shiftId: number,
        manager?: EntityManager,
    ): Promise<number> {
        const runner = manager ?? this.repo.manager;
        const row = await runner.query<{ total: string | null }[]>(
            `SELECT COALESCE(SUM(amount), 0) AS total
             FROM shift_cash_outs
             WHERE shift_id = $1 AND voided_at IS NULL`,
            [shiftId],
        );
        return parseFloat(row?.[0]?.total ?? '0') || 0;
    }

    /** Cash-out totals for many shifts at once (list view — avoids an N+1). */
    private async getCashOutTotalsBatch(
        shifts: Shift[],
    ): Promise<Map<number, number>> {
        const out = new Map<number, number>();
        if (shifts.length === 0) return out;
        const rows = await this.repo.manager.query<
            { shift_id: number; total: string | null }[]
        >(
            `SELECT shift_id, COALESCE(SUM(amount), 0) AS total
             FROM shift_cash_outs
             WHERE shift_id = ANY($1::int[]) AND voided_at IS NULL
             GROUP BY shift_id`,
            [shifts.map((s) => s.id)],
        );
        for (const r of rows)
            out.set(Number(r.shift_id), parseFloat(r.total ?? '0') || 0);
        return out;
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
        dto: { actual_cash: number; notes?: string },
        tenantId?: number | null,
        allowedBranchIds?: number[] | null,
        closedByUserId?: number | null,
        allowedBrandIds?: number[] | null,
        canOverride = false,
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
        assertShiftCloseAllowed(shift.userId, closedByUserId, canOverride);
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
        // Freeze the derived figure at close: from here on this shift is a
        // historical record and must not drift if an old order is touched later.
        //
        // The whole read-compute-write runs inside ONE transaction that first
        // takes a row lock on the shift. Without the lock, a cash-out committing
        // between the arithmetic and the UPDATE would be missing from the frozen
        // expected_cash and the drawer would read short by that amount forever.
        // The lock makes cash-outs and the close strictly serial: whichever gets
        // the row first wins, and a cash-out arriving after the close sees
        // status='closed' and is rejected.
        const cashCollected = (await this.getCollectedAmounts(shift))
            .cash_collected;
        await this.repo.manager.transaction(async (manager) => {
            const locked = await manager.query<{ status: string }[]>(
                `SELECT status FROM shifts WHERE id = $1 FOR UPDATE`,
                [id],
            );
            if (locked.length === 0)
                throw new NotFoundException('Shift not found');
            if (locked[0].status !== 'open')
                throw new ConflictException('Shift is already closed');

            const cashOutTotal = await this.getCashOutTotal(id, manager);
            const expectedAtClose = this.computeExpectedCash(
                shift,
                cashCollected,
                cashOutTotal,
            );
            // Still scoped by status: a full-entity save could write a stale
            // 'open' back over a concurrent close.
            const res = await manager
                .createQueryBuilder()
                .update(Shift)
                .set({
                    closingCash: dto.actual_cash,
                    status: 'closed',
                    closedAt: () => 'now()',
                    closedByUserId: closedByUserId ?? null,
                    expectedCash: expectedAtClose,
                    ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
                })
                .where('id = :id AND status = :open', { id, open: 'open' })
                .execute();
            if (res.affected === 0)
                throw new ConflictException('Shift is already closed');
        });
        const loaded = await this.repo.findOne({
            where: { id },
            relations: ['user', 'branch', 'closer', 'brand'],
        });
        if (!loaded) throw new NotFoundException('Shift not found');
        // The till's reconciliation is the most disputed number in the system:
        // expected vs counted, and who signed it off. Recorded as a diff so the
        // variance is visible without recomputing it from orders months later.
        ActivityContext.setScope({
            branchId: loaded.branchId,
            brandId: loaded.brandId ?? null,
        });
        ActivityContext.recordChange(
            'shift',
            id,
            { status: 'open', closing_cash: null, expected_cash: null },
            {
                status: 'closed',
                closing_cash: loaded.closingCash,
                expected_cash: loaded.expectedCash,
                variance:
                    Number(loaded.closingCash ?? 0) -
                    Number(loaded.expectedCash ?? 0),
                closed_by_user_id: closedByUserId ?? null,
            },
            `Shift #${id}`,
        );
        return this.toResponse(
            loaded,
            undefined,
            await this.getCashOutTotal(id),
        );
    }

    /**
     * Record cash handed out of the till mid-shift. Only while the shift is
     * open: once closed, its expected cash is frozen and a late entry would
     * silently misstate a historical reconciliation, so this 409s instead.
     * The row lock serialises against a concurrent close (see close()).
     */
    async addCashOut(
        shiftId: number,
        dto: { amount: number; note?: string | null },
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
        createdByUserId?: number | null,
    ) {
        // Tenant/branch/brand access (throws 403/404).
        await this.findOne(
            shiftId,
            tenantId,
            allowedBranchIds,
            allowedBrandIds,
        );
        const amount = Number(dto.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            throw new BadRequestException(
                'Cash-out amount must be greater than zero',
            );
        await this.repo.manager.transaction(async (manager) => {
            const locked = await manager.query<{ status: string }[]>(
                `SELECT status FROM shifts WHERE id = $1 FOR UPDATE`,
                [shiftId],
            );
            if (locked.length === 0)
                throw new NotFoundException('Shift not found');
            if (locked[0].status !== 'open')
                throw new ConflictException(
                    'This shift is closed — cash-outs can only be recorded while it is open.',
                );
            await manager.query(
                `INSERT INTO shift_cash_outs (shift_id, amount, note, created_by)
                 VALUES ($1, $2, $3, $4)`,
                [
                    shiftId,
                    amount,
                    dto.note?.trim() || null,
                    createdByUserId ?? null,
                ],
            );
        });
        // Cash leaving the drawer mid-shift. There is no "before" — this is an
        // addition, not an edit — so the diff records the movement itself.
        ActivityContext.recordChange(
            'shift_cash_out',
            shiftId,
            null,
            { amount, note: dto.note?.trim() || null },
            `Shift #${shiftId}`,
        );
        return this.listCashOuts(
            shiftId,
            tenantId,
            allowedBranchIds,
            allowedBrandIds,
        );
    }

    /**
     * Void a cash-out (wrong amount, or the money went back in). The row stays
     * for the audit trail and stops counting; open shifts only, for the same
     * reason as addCashOut.
     */
    async voidCashOut(
        shiftId: number,
        cashOutId: number,
        dto: { reason?: string | null },
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
        voidedByUserId?: number | null,
    ) {
        await this.findOne(
            shiftId,
            tenantId,
            allowedBranchIds,
            allowedBrandIds,
        );
        await this.repo.manager.transaction(async (manager) => {
            const locked = await manager.query<{ status: string }[]>(
                `SELECT status FROM shifts WHERE id = $1 FOR UPDATE`,
                [shiftId],
            );
            if (locked.length === 0)
                throw new NotFoundException('Shift not found');
            if (locked[0].status !== 'open')
                throw new ConflictException(
                    'This shift is closed — its cash-outs can no longer be changed.',
                );
            // Money coming back onto the till's expected figure. Recorded as
            // a reversal so it reads differently from the cash-out itself —
            // "was voided" is a distinct event from "was recorded".
            ActivityContext.recordChange(
                'shift_cash_out',
                cashOutId,
                { voided: false },
                { voided: true, void_reason: dto.reason?.trim() || null },
                `Cash-out #${cashOutId} on shift #${shiftId}`,
            );
            // Checked then updated inside the shift's row lock, so a
            // double-click cannot re-void (and rewrite the voider of) an entry
            // someone already voided.
            const existing = await manager.query<{ id: number }[]>(
                `SELECT id FROM shift_cash_outs
                 WHERE id = $1 AND shift_id = $2 AND voided_at IS NULL`,
                [cashOutId, shiftId],
            );
            if (existing.length === 0)
                throw new NotFoundException(
                    'Cash-out not found, or already voided',
                );
            await manager.query(
                `UPDATE shift_cash_outs
                 SET voided_at = now(), voided_by = $1, void_reason = $2
                 WHERE id = $3`,
                [voidedByUserId ?? null, dto.reason?.trim() || null, cashOutId],
            );
        });
        return this.listCashOuts(
            shiftId,
            tenantId,
            allowedBranchIds,
            allowedBrandIds,
        );
    }

    /**
     * Cash-outs of a shift, newest first — visible to anyone who may see the
     * shift (recording one needs `shifts:cash-out`; reading does not).
     */
    async listCashOuts(
        shiftId: number,
        tenantId: number | null,
        allowedBranchIds?: number[] | null,
        allowedBrandIds?: number[] | null,
    ) {
        await this.findOne(
            shiftId,
            tenantId,
            allowedBranchIds,
            allowedBrandIds,
        );
        const rows = await this.repo.manager.query<
            {
                id: number;
                amount: string;
                note: string | null;
                created_at: Date;
                created_by_name: string | null;
                voided_at: Date | null;
                void_reason: string | null;
                voided_by_name: string | null;
            }[]
        >(
            `SELECT co.id, co.amount, co.note, co.created_at, co.voided_at,
                    co.void_reason,
                    cu.name AS created_by_name, vu.name AS voided_by_name
             FROM shift_cash_outs co
             LEFT JOIN users cu ON cu.id = co.created_by
             LEFT JOIN users vu ON vu.id = co.voided_by
             WHERE co.shift_id = $1
             ORDER BY co.created_at DESC, co.id DESC`,
            [shiftId],
        );
        const items = rows.map((r) => ({
            id: Number(r.id),
            amount: parseFloat(r.amount ?? '0') || 0,
            note: r.note,
            created_at: r.created_at?.toISOString?.() ?? null,
            created_by_name: r.created_by_name,
            voided: r.voided_at != null,
            voided_at: r.voided_at?.toISOString?.() ?? null,
            voided_by_name: r.voided_by_name,
            void_reason: r.void_reason,
        }));
        return {
            shift_id: shiftId,
            items,
            // Voided entries are listed but never counted.
            total: items
                .filter((i) => !i.voided)
                .reduce((sum, i) => sum + i.amount, 0),
        };
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
            online_transfer_collected: access.online_transfer_collected ?? 0,
            orders: serialized,
        };
    }

    /**
     * @param expectedOverride derived expected cash for an open shift. Closed
     * shifts pass nothing and keep the value frozen at close.
     */
    private toResponse(s: Shift, expectedOverride?: number, cashOutTotal = 0) {
        const expected =
            expectedOverride !== undefined
                ? expectedOverride
                : s.expectedCash != null
                  ? Number(s.expectedCash)
                  : null;
        // Actual cash is simply what was counted in the drawer: cash handed
        // out mid-shift already left it, and is accounted for on the expected
        // side instead (see computeExpectedCash).
        const actual = s.closingCash != null ? Number(s.closingCash) : null;
        return {
            id: s.id,
            branch_id: s.branchId,
            brand_id: s.brandId ?? null,
            brand: s.brand ? { id: s.brand.id, name: s.brand.name } : null,
            user_id: s.userId,
            shift_number: s.shiftNumber,
            opening_cash: Number(s.openingCash),
            expected_cash: expected,
            /** Money counted in the drawer at close. */
            drawer_cash: actual,
            /** Cash handed out of the till mid-shift (voided entries excluded). */
            cash_out_total: cashOutTotal,
            actual_cash: actual,
            difference:
                actual != null && expected != null
                    ? round2(actual - expected)
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
