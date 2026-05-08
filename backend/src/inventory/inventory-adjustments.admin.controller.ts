import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Patch,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';
import { InventoryAdjustmentService } from './inventory-adjustment.service';

@ApiTags('Admin – Inventory Adjustments')
@ApiBearerAuth()
@Controller('admin/inventory/adjustments')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class InventoryAdjustmentsAdminController {
    constructor(
        private inventoryService: InventoryService,
        private adjustmentService: InventoryAdjustmentService,
    ) {}

    @Get()
    async listAdjustments(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Query('branch_id') branchId: string,
    ) {
        const branch = Number(branchId);
        if (!Number.isFinite(branch) || branch <= 0) {
            throw new BadRequestException('branch_id is required');
        }
        const tenantId = await this.inventoryService.resolveTenantId(
            user,
            branch,
        );
        return this.adjustmentService.listAdjustments(tenantId, branch);
    }

    @Post()
    createAdjustment(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            branch_id: number;
            adjustment_type: 'in' | 'out';
            reason_code: string;
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                qty: number;
                qty_uom_id: number;
                location_id?: number | null;
                inventory_batch_id?: number | null;
                lot_code?: string | null;
                expiry_date?: string | null;
                notes?: string | null;
            }>;
        },
    ) {
        return this.adjustmentService.createAdjustment(user, dto);
    }

    @Post(':id/post')
    postAdjustment(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        return this.adjustmentService.postAdjustment(user, +id);
    }

    @Patch(':id')
    updateDraftAdjustment(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body()
        dto: {
            reason_code?: string;
            notes?: string | null;
            lines: Array<{
                inventory_item_id: number;
                qty: number;
                qty_uom_id: number;
                location_id?: number | null;
                inventory_batch_id?: number | null;
                lot_code?: string | null;
                expiry_date?: string | null;
                notes?: string | null;
            }>;
        },
    ) {
        return this.adjustmentService.updateDraftAdjustment(user, +id, dto);
    }

    @Delete(':id')
    deleteDraftAdjustment(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        return this.adjustmentService.deleteDraftAdjustment(user, +id);
    }
}
