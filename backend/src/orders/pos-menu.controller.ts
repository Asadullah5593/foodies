import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MenuService } from '../menu/menu.service';
import { ShiftsService } from '../shifts/shifts.service';
import { BranchesService } from '../branches/branches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { scopeBranchIds } from './branch-scope';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';

/**
 * Active branches first, then by name.
 *
 * The POS defaults to the first entry of this list, so ordering is not
 * cosmetic: sorting by name alone hands the till a branch that takes no
 * orders the moment an inactive one sorts earlier. Inactive branches stay in
 * the list — the operator can still select one deliberately and gets the
 * "branch is inactive" screen — they just stop being the default.
 */
export function byActiveThenName(
    a: { name: string; is_active: boolean },
    b: { name: string; is_active: boolean },
): number {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.name.localeCompare(b.name);
}

@ApiTags('POS – Menu')
@ApiBearerAuth()
@Controller('pos')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class PosMenuController {
    constructor(
        private menuService: MenuService,
        private shiftsService: ShiftsService,
        private branchesService: BranchesService,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
    ) {}

    /**
     * Branches the current user may sell at that currently have an open shift.
     * Scope comes from RoleAccessGuard's `allowedBranchIds` (null = every
     * branch, for all-branches:access holders and the super admin) — the
     * same value the admin order history is scoped by. This used to hand a
     * tenant user every branch in the tenant "(incl. not assigned)", which is
     * how a cashier assigned to one branch could switch the till to another.
     */
    @Get('branches')
    async branches(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBranchIds?: number[] | null;
        },
    ): Promise<
        { id: number; name: string; code: string; is_active: boolean }[]
    > {
        const openBranchIds = scopeBranchIds(
            user,
            await this.shiftsService.findBranchIdsWithOpenShift(),
        );
        if (openBranchIds.length === 0) return [];

        if (user.isSuperAdmin === true) {
            const branches = await this.branchRepo.find({
                where: { id: In(openBranchIds) },
                select: ['id', 'name', 'code', 'isActive'],
                // Active first: the POS takes posBranches[0] as its default, so
                // a plain name sort hands the till a branch that refuses orders
                // whenever an inactive one happens to sort earlier.
                order: { isActive: 'DESC', name: 'ASC' },
            });
            return branches.map((b) => ({
                id: b.id,
                name: b.name,
                code: b.code,
                is_active: b.isActive !== false,
            }));
        }

        if (user.tenantId == null) return [];
        const tenantBranches = await this.branchesService.findAllForAdmin(
            user.tenantId,
        );
        const openSet = new Set(openBranchIds);
        return tenantBranches
            .filter((b) => openSet.has(b.id))
            .map((b) => ({
                id: b.id,
                name: b.name,
                code: b.code,
                is_active: b.is_active !== false,
            }))
            .sort(byActiveThenName);
    }

    @Get('menu')
    @ApiQuery({
        name: 'order_type',
        required: false,
        description:
            'Optional filter: only items available for this channel (delivery, pickup, dine_in; takeaway maps to pickup).',
    })
    async index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBrandIds?: number[] | null;
            allowedBranchIds?: number[] | null;
        },
        @Query('branch_id') branchIdParam: string,
        @Query('order_type') orderTypeParam: string,
    ) {
        // The guard's scope, not a recomputation: null = every branch. The
        // old derivation listed every tenant branch as "allowed", which made
        // the "not assigned to this branch" refusal below unreachable.
        const allowedBranchIds: number[] | null =
            user.isSuperAdmin === true ? null : (user.allowedBranchIds ?? null);

        let branchId = branchIdParam ? +branchIdParam : null;
        if (!branchId && allowedBranchIds != null && allowedBranchIds.length)
            branchId = allowedBranchIds[0];
        if (
            allowedBranchIds != null &&
            allowedBranchIds.length === 0 &&
            !branchId
        ) {
            return {
                branch_id: null,
                menu: [],
                open_shift: null,
                message:
                    'No branch assigned. Assign this user to a branch in Branch Users.',
            };
        }
        if (
            branchId != null &&
            allowedBranchIds != null &&
            !allowedBranchIds.includes(branchId)
        ) {
            return {
                branch_id: null,
                menu: [],
                open_shift: null,
                message: 'You are not assigned to this branch.',
            };
        }
        if (!branchId) {
            return {
                branch_id: null,
                menu: [],
                open_shift: null,
                message: 'Select a branch.',
            };
        }
        const [branch, menu, openShifts] = await Promise.all([
            this.branchRepo.findOne({
                where: { id: branchId },
                relations: ['branchBrands', 'branchBrands.brand'],
            }),
            this.menuService.getBranchMenu(branchId, {
                orderType:
                    orderTypeParam != null && orderTypeParam.trim() !== ''
                        ? orderTypeParam.trim()
                        : undefined,
                channel: 'pos',
            }),
            this.shiftsService.findOpenShiftsByBranch(branchId),
        ]);
        // Always return order-type flags so POS dropdown can be dynamic (strict true = show option)
        const supports_dine_in = branch?.supportsDineIn === true;
        // Pickup is deprecated; treat legacy supportsPickup as takeaway.
        const supports_takeaway =
            branch?.supportsTakeaway === true ||
            branch?.supportsPickup === true;
        const supports_delivery = branch?.supportsDelivery === true;
        type BranchWithBrands = {
            branchBrands?: Array<{ brandId: number; brand?: { name: string } }>;
        };
        const branchBrands = (branch as BranchWithBrands)?.branchBrands ?? [];
        let brands = branchBrands.map((bb) => ({
            id: bb.brandId,
            name: bb.brand?.name ?? '',
        }));
        // Brand-locked till: only the user's own brand(s) are sold here.
        const lockedBrandIds = user.allowedBrandIds ?? null;
        let scopedMenu = menu;
        if (lockedBrandIds != null) {
            const lockedSet = new Set(lockedBrandIds);
            scopedMenu = menu.filter(
                (item) => item.brand_id != null && lockedSet.has(item.brand_id),
            );
            brands = brands.filter((b) => lockedSet.has(b.id));
        }
        // Shifts are per brand: a brand-locked till sees its own brand's
        // shift; unrestricted users get the full per-brand list. open_shift
        // is kept for backward compatibility (the locked brand's shift, or
        // the first open one).
        const visibleShifts =
            lockedBrandIds != null
                ? openShifts.filter(
                      (s) =>
                          s.brand_id != null &&
                          lockedBrandIds.includes(s.brand_id),
                  )
                : openShifts;
        return {
            branch_id: branchId,
            branch_active: branch?.isActive === true,
            menu: scopedMenu,
            open_shift: visibleShifts[0] ?? null,
            open_shifts: visibleShifts,
            open_shift_brand_ids: visibleShifts
                .map((s) => s.brand_id)
                .filter((id): id is number => id != null),
            supports_dine_in,
            supports_takeaway,
            supports_delivery,
            brands,
            locked_brand_ids: lockedBrandIds,
        };
    }

    /** Get deal definition by menu item id for POS (slot pickers + choice items). Returns null if not a deal. */
    @Get('deal/:menuItemId')
    @ApiQuery({
        name: 'order_type',
        required: false,
        description:
            'Optional. Filters deal slot choice items to those available for this channel.',
    })
    async getDeal(
        @Param('menuItemId') menuItemIdParam: string,
        @Query('branch_id') branchIdParam: string,
        @Query('order_type') orderTypeParam: string,
    ) {
        const menuItemId = +menuItemIdParam;
        const branchId = branchIdParam ? +branchIdParam : NaN;
        if (!Number.isFinite(menuItemId) || !Number.isFinite(branchId))
            return null;
        const orderType =
            orderTypeParam != null && orderTypeParam.trim() !== ''
                ? orderTypeParam.trim()
                : undefined;
        return this.menuService.getDealByMenuItemId(
            menuItemId,
            branchId,
            orderType,
            'pos',
        );
    }
}
