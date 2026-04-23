import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';

@ApiTags('Admin – Inventory')
@ApiBearerAuth()
@Controller('admin/inventory')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class InventoryAdminController {
    constructor(private inventoryService: InventoryService) {}

    @Get('branches/:branchId/on-hand')
    async onHand(
        @CurrentUser() user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user, +branchId);
        return this.inventoryService.listOnHand(tenantId, +branchId);
    }

    @Get('branches/:branchId/ledger')
    async ledger(
        @CurrentUser() user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Query('limit') limit?: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user, +branchId);
        return this.inventoryService.listLedger(tenantId, +branchId, limit ? +limit : 200);
    }

    @Post('branches/:branchId/wastage')
    async wastage(
        @CurrentUser() user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
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
        const tenantId = await this.inventoryService.resolveTenantId(user, +branchId);
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
}

