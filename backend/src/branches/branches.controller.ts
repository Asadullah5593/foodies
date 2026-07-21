import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { BranchMenuItemsService } from '../branch-menu-items/branch-menu-items.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Branches')
@ApiBearerAuth()
@Controller('admin/branches')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BranchesController {
    constructor(
        private service: BranchesService,
        private branchMenuItemsService: BranchMenuItemsService,
    ) {}

    @Get()
    index(
        @Query('brand_id') brandId: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
    ) {
        return this.service.findAllForAdmin(
            user.tenantId,
            brandId ? +brandId : undefined,
            user.allowedBranchIds,
        );
    }

    @Get(':id')
    show(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.findOneForAdmin(+id, user.tenantId);
    }

    @Post()
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_CREATE)
    async store(
        @Body()
        dto: {
            /** One or more brands (e.g. food court: multiple brands at one branch). */
            brand_ids: number[];
            name: string;
            code?: string;
            address?: string;
            phone?: string;
            email?: string;
            timezone?: string;
            operating_hours?: Record<string, unknown>;
            supports_dine_in?: boolean;
            supports_takeaway?: boolean;
            supports_delivery?: boolean;
            delivery_flat_fee?: number;
            delivery_radius_km?: number;
            premises_radius_m?: number;
            auto_dispatch_enabled?: boolean;
            gst_rate_cash?: number | null;
            gst_rate_card?: number | null;
            is_active?: boolean;
            status?: string;
            latitude?: number | null;
            longitude?: number | null;
            /** Tenant-level menu items to link (copy-on-link) to this new branch. */
            menu_item_ids?: number[];
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        const { menu_item_ids, ...branchDto } = dto;
        const created = await this.service.createForAdmin(
            branchDto,
            user.tenantId,
        );
        if (Array.isArray(menu_item_ids) && menu_item_ids.length) {
            await this.branchMenuItemsService.sync(created.id, menu_item_ids);
        }
        return created;
    }

    @Put(':id')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_EDIT)
    async update(
        @Param('id') id: string,
        @Body()
        dto: {
            brand_ids?: number[];
            name?: string;
            code?: string;
            address?: string;
            phone?: string;
            email?: string;
            timezone?: string;
            operating_hours?: Record<string, unknown>;
            supports_dine_in?: boolean;
            supports_takeaway?: boolean;
            supports_delivery?: boolean;
            delivery_flat_fee?: number;
            delivery_radius_km?: number;
            premises_radius_m?: number;
            auto_dispatch_enabled?: boolean;
            gst_rate_cash?: number | null;
            gst_rate_card?: number | null;
            is_active?: boolean;
            status?: string;
            latitude?: number | null;
            longitude?: number | null;
            fbr_enabled?: boolean;
            fbr_pos_id?: string | null;
            fbr_token?: string | null;
            fbr_environment?: string;
            fbr_pct_code?: string | null;
            /** Desired brand-level menu item ids to link to this branch (mapping only). */
            menu_item_ids?: number[];
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        const { menu_item_ids, ...branchDto } = dto;
        const updated = await this.service.updateForAdmin(
            +id,
            user.tenantId,
            branchDto,
        );
        if (Array.isArray(menu_item_ids)) {
            await this.branchMenuItemsService.sync(+id, menu_item_ids);
        }
        return updated;
    }

    @Delete(':id')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_DELETE)
    destroy(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.removeForAdmin(+id, user.tenantId);
    }

    // --- Per-(branch,brand) online open/close ---

    @Get(':id/brand-availability')
    brandAvailability(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.getBrandAvailability(
            +id,
            user.tenantId,
            user.allowedBrandIds,
            user.allowedBranchIds,
        );
    }

    /** Toggle ONE brand's online availability at this branch. */
    @Patch(':id/brands/:brandId/availability')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANDS_TOGGLE_OPEN)
    setBrandAvailability(
        @Param('id') id: string,
        @Param('brandId') brandId: string,
        @Body() dto: { is_open: boolean },
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.setBrandAvailability(
            +id,
            +brandId,
            dto.is_open !== false,
            user.id,
            user.allowedBrandIds,
            user.allowedBranchIds,
        );
    }

    /** Bulk: close/open ALL brands at this branch (GM / branch-manager only). */
    @Patch(':id/brands-availability')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANDS_TOGGLE_OPEN)
    setAllBrandsAvailability(
        @Param('id') id: string,
        @Body() dto: { is_open: boolean },
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (user.allowedBrandIds != null) {
            throw new ForbiddenException(
                'Closing all brands at a branch is a manager action',
            );
        }
        return this.service.setAllBrandsAvailabilityAtBranch(
            +id,
            dto.is_open !== false,
            user.id,
            user.allowedBranchIds,
        );
    }
}
