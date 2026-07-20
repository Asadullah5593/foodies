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
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Admin – Inventory – Vendors')
@ApiBearerAuth()
@Controller('admin/inventory/vendors')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class VendorsAdminController {
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
        return this.inventoryService.listVendors(tenantId);
    }

    @Post()
    @RequirePermission(Permissions.VENDORS_CREATE)
    async create(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            name: string;
            type?: string;
            linked_branch_id?: number | null;
            email?: string | null;
            phone?: string | null;
            address?: string | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            dto.linked_branch_id ?? undefined,
        );
        return this.inventoryService.createVendor(tenantId, dto);
    }

    @Patch(':id')
    @RequirePermission(Permissions.VENDORS_EDIT)
    async update(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id')
        id: string,
        @Body()
        dto: {
            name?: string;
            type?: string;
            linked_branch_id?: number | null;
            email?: string | null;
            phone?: string | null;
            address?: string | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            dto.linked_branch_id ?? undefined,
        );
        return this.inventoryService.updateVendor(tenantId, Number(id), dto);
    }

    @Delete(':id')
    @RequirePermission(Permissions.VENDORS_DELETE)
    async remove(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id')
        id: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.deactivateVendor(tenantId, Number(id));
    }
}
