import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';

@ApiTags('Admin – Inventory – Items')
@ApiBearerAuth()
@Controller('admin/inventory/items')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class InventoryItemsAdminController {
    constructor(private inventoryService: InventoryService) {}

    @Get()
    async index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.listItems(tenantId);
    }

    @Post()
    async create(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            name: string;
            code: string;
            type?: string;
            base_uom_id: number;
            base_uom_ids?: number[];
            track_expiry?: boolean;
            track_lot?: boolean;
            default_reorder_point?: number | null;
            default_near_expiry_days?: number | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.createItem(tenantId, dto);
    }

    @Patch(':id')
    async update(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id')
        id: string,
        @Body()
        dto: {
            name?: string;
            code?: string;
            type?: string;
            base_uom_id?: number;
            base_uom_ids?: number[];
            track_expiry?: boolean;
            track_lot?: boolean;
            default_reorder_point?: number | null;
            default_near_expiry_days?: number | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.updateItem(tenantId, Number(id), dto);
    }

    @Delete(':id')
    async remove(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id')
        id: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.deactivateItem(tenantId, Number(id));
    }

    @Post(':id/branch/:branchId/settings')
    async upsertBranchSettings(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Param('branchId') branchId: string,
        @Body()
        dto: {
            reorder_point?: number | null;
            near_expiry_days?: number | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            +branchId,
        );
        return this.inventoryService.upsertBranchItemSettings(
            tenantId,
            +branchId,
            +id,
            dto,
        );
    }
}
