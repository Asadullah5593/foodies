import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BrandsService } from './brands.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { DeliveryTierConfig } from '../entities/brand.entity';

@ApiTags('Admin – Brands')
@ApiBearerAuth()
@Controller('admin/brands')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BrandsController {
    constructor(private service: BrandsService) {}

    @Get()
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.findAllForAdmin(
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Get(':id')
    show(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.findOneForAdmin(
            +id,
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Post()
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_MANAGE)
    store(
        @Body()
        dto: {
            name: string;
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
            delivery_flat_fee?: number;
        },
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (user.tenantId == null)
            throw new ForbiddenException(
                'Super admin cannot create brands; use a tenant user.',
            );
        if (user.allowedBrandIds != null)
            throw new ForbiddenException(
                'Brand-locked accounts cannot create brands',
            );
        return this.service.create(dto, user.tenantId);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        dto: {
            name?: string;
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
            delivery_flat_fee?: number;
        },
    ) {
        // Brand admins configure their OWN brand (delivery fee, logo, …);
        // any other brand is off-limits. Unlocked users are owner/GM level
        // (tenant-scoped in the service).
        if (
            user.allowedBrandIds != null &&
            !user.allowedBrandIds.includes(+id)
        ) {
            throw new ForbiddenException('You can only manage your own brand');
        }
        return this.service.updateForAdmin(+id, user.tenantId, dto);
    }

    @Get(':id/loyalty-settings')
    getLoyaltySettings(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.getLoyaltySettings(
            +id,
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Put(':id/loyalty-settings')
    updateLoyaltySettings(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        dto: {
            loyalty_enabled?: boolean;
            display_name?: string;
            spend_per_point?: number;
            min_order_to_earn?: number;
            cash_value_per_point?: number;
            min_order_to_redeem?: number;
            expiry_period?: number;
            expiry_unit?: 'day' | 'month' | 'year';
        },
    ) {
        // Brand admins manage their OWN brand's loyalty program; owner/GM (unlocked)
        // are tenant-scoped in the service. Mirrors the brand update authorization.
        if (
            user.allowedBrandIds != null &&
            !user.allowedBrandIds.includes(+id)
        ) {
            throw new ForbiddenException('You can only manage your own brand');
        }
        return this.service.updateLoyaltySettings(
            +id,
            user.tenantId,
            user.allowedBrandIds,
            dto,
        );
    }

    @Get(':id/delivery-tiers')
    getDeliveryTiers(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.getDeliveryTiers(
            +id,
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Put(':id/delivery-tiers')
    updateDeliveryTiers(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        dto: {
            delivery_tiers_enabled?: boolean;
            tiers?: {
                saver?: Partial<DeliveryTierConfig>;
                standard?: Partial<DeliveryTierConfig>;
                priority?: Partial<DeliveryTierConfig>;
                saverHoldMinutes?: number;
                maxBatchSize?: number;
            };
        },
    ) {
        // Brand admins manage their OWN brand only; owner/GM are tenant-scoped in the service.
        if (
            user.allowedBrandIds != null &&
            !user.allowedBrandIds.includes(+id)
        ) {
            throw new ForbiddenException('You can only manage your own brand');
        }
        return this.service.updateDeliveryTiers(
            +id,
            user.tenantId,
            user.allowedBrandIds,
            dto,
        );
    }

    /** Branches this brand is at, with each branch's online open state (for the picker). */
    @Get(':id/branch-availability')
    branchAvailability(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
            allowedBranchIds?: number[] | null;
        },
    ) {
        return this.service.getBranchAvailability(
            +id,
            user.tenantId,
            user.allowedBrandIds,
            user.allowedBranchIds,
        );
    }

    /** Open/close this brand's online ordering across all its branches. */
    @Patch(':id/availability')
    setAvailabilityEverywhere(
        @Param('id') id: string,
        @Body() dto: { is_open: boolean },
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
            allowedBranchIds?: number[] | null;
        },
    ) {
        return this.service.setAvailabilityEverywhere(
            +id,
            dto.is_open !== false,
            user.id,
            user.tenantId,
            user.allowedBrandIds,
            user.allowedBranchIds,
        );
    }

    @Delete(':id')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_MANAGE)
    destroy(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (user.allowedBrandIds != null)
            throw new ForbiddenException(
                'Brand-locked accounts cannot delete brands',
            );
        return this.service.removeForAdmin(+id, user.tenantId);
    }
}
