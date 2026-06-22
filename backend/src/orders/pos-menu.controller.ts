import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MenuService } from '../menu/menu.service';
import { ShiftsService } from '../shifts/shifts.service';
import { BranchesService } from '../branches/branches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { Branch } from '../entities/branch.entity';

@ApiTags('POS – Menu')
@ApiBearerAuth()
@Controller('pos')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class PosMenuController {
    constructor(
        private menuService: MenuService,
        private shiftsService: ShiftsService,
        private branchesService: BranchesService,
        @InjectRepository(User) private userRepo: Repository<User>,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
    ) {}

    /** Branches the current user can use for POS: super admin = all branches with open shift; tenant user = tenant's branches with open shift (incl. not assigned). */
    @Get('branches')
    async branches(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
        },
    ): Promise<{ id: number; name: string; code: string }[]> {
        const openBranchIds =
            await this.shiftsService.findBranchIdsWithOpenShift();
        if (openBranchIds.length === 0) return [];

        if (user.isSuperAdmin === true) {
            const branches = await this.branchRepo.find({
                where: { id: In(openBranchIds) },
                select: ['id', 'name', 'code'],
                order: { name: 'ASC' },
            });
            return branches.map((b) => ({
                id: b.id,
                name: b.name,
                code: b.code,
            }));
        }

        if (user.tenantId != null) {
            const tenantBranches = await this.branchesService.findAllForAdmin(
                user.tenantId,
            );
            const openSet = new Set(openBranchIds);
            return tenantBranches
                .filter((b) => openSet.has(b.id))
                .map((b) => ({ id: b.id, name: b.name, code: b.code }))
                .sort((a, b) => a.name.localeCompare(b.name));
        }

        const dbUser = await this.userRepo.findOne({
            where: { id: user.id },
            relations: ['branchUsers', 'branchUsers.branch'],
        });
        if (!dbUser?.branchUsers?.length) return [];
        const branchIds = new Set<number>();
        const list: { id: number; name: string; code: string }[] = [];
        const openSet = new Set(openBranchIds);
        for (const bu of dbUser.branchUsers) {
            const branch = (bu as { branch?: Branch }).branch;
            if (branch && !branchIds.has(branch.id) && openSet.has(branch.id)) {
                branchIds.add(branch.id);
                list.push({
                    id: branch.id,
                    name: branch.name,
                    code: branch.code,
                });
            }
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
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
        },
        @Query('branch_id') branchIdParam: string,
        @Query('order_type') orderTypeParam: string,
    ) {
        let allowedBranchIds: number[] | null = null;
        if (user.isSuperAdmin === true) {
            allowedBranchIds = null;
        } else if (user.tenantId != null) {
            const tenantBranches = await this.branchesService.findAllForAdmin(
                user.tenantId,
            );
            allowedBranchIds = tenantBranches.map((b) => b.id);
        } else {
            const dbUser = await this.userRepo.findOne({
                where: { id: user.id },
                relations: ['branchUsers'],
            });
            allowedBranchIds = dbUser?.branchUsers?.length
                ? dbUser.branchUsers.map((bu) => bu.branchId)
                : [];
        }

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
        );
    }
}
