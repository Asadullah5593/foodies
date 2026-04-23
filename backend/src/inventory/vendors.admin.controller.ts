import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';

@ApiTags('Admin – Inventory – Vendors')
@ApiBearerAuth()
@Controller('admin/inventory/vendors')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class VendorsAdminController {
    constructor(private inventoryService: InventoryService) {}

    @Get()
    async index(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.listVendors(tenantId);
    }

    @Post()
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

