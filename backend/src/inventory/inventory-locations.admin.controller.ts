import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Admin – Inventory – Locations')
@ApiBearerAuth()
@Controller('admin/inventory/branches/:branchId/locations')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class InventoryLocationsAdminController {
    constructor(private inventoryService: InventoryService) {}

    @Get()
    async index(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.listLocations(tenantId, +branchId);
    }

    @Post()
    @RequirePermission(Permissions.INVENTORY_ADJUST)
    async create(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('branchId') branchId: string,
        @Body() dto: { name: string; code: string },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.createLocation(tenantId, +branchId, dto);
    }
}
