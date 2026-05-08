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

@ApiTags('Admin – Inventory – UOMs')
@ApiBearerAuth()
@Controller('admin/inventory/uoms')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class UomsAdminController {
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
        return this.inventoryService.listUoms(tenantId);
    }

    @Post()
    async create(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            name: string;
            code: string;
            kind?: string;
            base_uom_id?: number | null;
            multiplier_to_base?: number | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.createUom(tenantId, dto);
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
            kind?: string;
            base_uom_id?: number | null;
            multiplier_to_base?: number | null;
        },
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.updateUom(tenantId, Number(id), dto);
    }

    @Delete(':id')
    async remove(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id')
        id: string,
    ) {
        const tenantId = await this.inventoryService.resolveTenantId(user);
        return this.inventoryService.deactivateUom(tenantId, Number(id));
    }
}
