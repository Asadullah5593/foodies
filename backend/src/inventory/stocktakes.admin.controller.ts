import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Admin – Inventory – Stocktakes & Alerts')
@ApiBearerAuth()
@Controller('admin/inventory/branches/:branchId')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class StocktakesAdminController {
    constructor(private inventoryService: InventoryService) {}

    @Get('low-stock')
    async lowStock(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.getLowStockAlerts(tenantId, +branchId);
    }

    @Get('near-expiry')
    async nearExpiry(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.getNearExpiryAlerts(tenantId, +branchId);
    }

    @Get('expiry-coverage-warnings')
    async expiryCoverageWarnings(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.getExpiryCoverageWarnings(
            tenantId,
            +branchId,
        );
    }

    @Post('stocktakes')
    @RequirePermission(Permissions.INVENTORY_STOCKTAKE)
    async createStocktake(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Body()
        dto: { week_start: string; week_end: string; finance_day: string },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.createStocktake({
            tenantId,
            branchId: +branchId,
            weekStart: dto.week_start,
            weekEnd: dto.week_end,
            financeDay: dto.finance_day,
            createdBy: user.id,
        });
    }

    @Post('stocktakes/:stocktakeId/lines')
    @RequirePermission(Permissions.INVENTORY_STOCKTAKE)
    async upsertLine(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Param('stocktakeId') stocktakeId: string,
        @Body()
        dto: {
            inventory_item_id: number;
            counted_qty: number;
            counted_uom_id: number;
            location_id?: number | null;
            notes?: string | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.upsertStocktakeLine({
            tenantId,
            branchId: +branchId,
            stocktakeId: +stocktakeId,
            inventoryItemId: dto.inventory_item_id,
            countedQty: dto.counted_qty,
            countedUomId: dto.counted_uom_id,
            locationId: dto.location_id ?? null,
            notes: dto.notes ?? null,
        });
    }

    @Post('stocktakes/:stocktakeId/submit')
    @RequirePermission(Permissions.INVENTORY_STOCKTAKE)
    async submit(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Param('stocktakeId') stocktakeId: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.submitStocktake({
            tenantId,
            branchId: +branchId,
            stocktakeId: +stocktakeId,
            submittedBy: user.id,
        });
    }

    @Post('stocktakes/:stocktakeId/close')
    @RequirePermission(Permissions.INVENTORY_STOCKTAKE)
    async close(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Param('stocktakeId') stocktakeId: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.closeStocktake({
            tenantId,
            branchId: +branchId,
            stocktakeId: +stocktakeId,
            closedBy: user.id,
        });
    }

    @Post('weekly-usage')
    @RequirePermission(Permissions.INVENTORY_STOCKTAKE)
    async weeklyUsage(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Body() dto: { from: string; to: string },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.getWeeklyUsageReport({
            tenantId,
            branchId: +branchId,
            from: dto.from,
            to: dto.to,
        });
    }
}
