import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { InventoryService } from './inventory.service';
import { InventoryAlertsJob } from './inventory-alerts.job';

@ApiTags('Admin – Inventory')
@ApiBearerAuth()
@Controller('admin/inventory')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class InventoryAdminController {
    constructor(
        private inventoryService: InventoryService,
        private inventoryAlertsJob: InventoryAlertsJob,
    ) {}

    /** Trigger the low-stock + near-expiry notification sweeps immediately. */
    @Post('alerts/run')
    @RequirePermission(Permissions.INVENTORY_VIEW)
    runAlertSweeps() {
        return this.inventoryAlertsJob.runNow();
    }

    /** Cross-branch on-hand for one brand bucket — brand admin "my brand stock". */
    @Get('brands/:brandId/on-hand')
    async brandOnHand(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Param('brandId') brandId: string,
    ) {
        const brandIdNum = +brandId;
        // Brand-lock: a brand-locked caller may only read their own brand(s).
        if (
            Array.isArray(user.allowedBrandIds) &&
            user.allowedBrandIds.length > 0 &&
            !user.allowedBrandIds.includes(brandIdNum)
        ) {
            throw new ForbiddenException(
                'You are not allowed to view this brand',
            );
        }
        const tenantId = await this.inventoryService.resolveTenantIdForBrand(
            user,
            brandIdNum,
        );
        return this.inventoryService.getBrandOnHand({
            tenantId,
            brandId: brandIdNum,
            allowedBranchIds: user.allowedBranchIds ?? null,
        });
    }

    @Get('branches/:branchId/on-hand')
    async onHand(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBrandIds?: number[] | null;
        },
        @Param('branchId') branchId: string,
        @Query('brand_id') brandId?: string,
        @Query('flagged') flagged?: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.listOnHand(tenantId, +branchId, {
            brandId:
                brandId === undefined || brandId === ''
                    ? undefined
                    : brandId === 'null' || brandId === 'pool'
                      ? null
                      : +brandId,
            flaggedOnly: flagged === '1' || flagged === 'true',
            allowedBrandIds: user.allowedBrandIds ?? null,
        });
    }

    @Get('branches/:branchId/ledger')
    async ledger(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Query('event_type') eventType?: string,
        @Query('inventory_item_id') inventoryItemId?: string,
        @Query('event_ref_type') eventRefType?: string,
        @Query('event_ref_id') eventRefId?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('page') page?: string,
        @Query('page_size') pageSize?: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.listLedger(tenantId, +branchId, {
            eventType,
            inventoryItemId: inventoryItemId ? +inventoryItemId : undefined,
            eventRefType,
            eventRefId: eventRefId ? +eventRefId : undefined,
            from,
            to,
            page: page ? +page : undefined,
            pageSize: pageSize ? +pageSize : undefined,
        });
    }

    @Get('brands/:brandId/ledger-summary')
    async brandLedgerSummary(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBrandIds?: number[] | null;
        },
        @Param('brandId') brandId: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('branch_id') branchIdForSuperAdmin?: string,
    ) {
        // Brand-lock: a brand-locked caller may only read their own brand(s).
        if (
            Array.isArray(user.allowedBrandIds) &&
            user.allowedBrandIds.length > 0 &&
            !user.allowedBrandIds.includes(+brandId)
        ) {
            throw new ForbiddenException(
                'You are not allowed to view this brand',
            );
        }
        const tenantId =
            user.tenantId != null
                ? user.tenantId
                : await this.inventoryService.resolveTenantId(
                      user,
                      branchIdForSuperAdmin
                          ? +branchIdForSuperAdmin
                          : undefined,
                  );
        return this.inventoryService.getBrandLedgerSummary({
            tenantId,
            brandId: +brandId,
            from,
            to,
        });
    }

    @Post('branches/:branchId/wastage')
    @RequirePermission(Permissions.INVENTORY_WASTE)
    async wastage(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Body()
        dto: {
            inventory_item_id: number;
            qty: number;
            qty_uom_id: number;
            reason: string;
            notes?: string;
            location_id?: number;
            inventory_batch_id?: number;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.recordWastage({
            tenantId,
            branchId: +branchId,
            inventoryItemId: dto.inventory_item_id,
            qty: dto.qty,
            qtyUomId: dto.qty_uom_id,
            reason: dto.reason,
            notes: dto.notes ?? null,
            locationId: dto.location_id ?? null,
            inventoryBatchId: dto.inventory_batch_id ?? null,
            createdBy: user.id,
        });
    }

    @Get('branches/:branchId/wastage')
    async listWastage(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Query('inventory_item_id') inventoryItemId?: string,
        @Query('reason') reason?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('page') page?: string,
        @Query('page_size') pageSize?: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.listWastage(tenantId, +branchId, {
            inventoryItemId: inventoryItemId ? +inventoryItemId : undefined,
            reason,
            from,
            to,
            page: page ? +page : undefined,
            pageSize: pageSize ? +pageSize : undefined,
        });
    }
}
