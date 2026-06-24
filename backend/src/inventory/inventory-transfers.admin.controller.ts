import {
    BadRequestException,
    Body,
    Controller,
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
import { InventoryService } from './inventory.service';
import { InventoryTransferService } from './inventory-transfer.service';

@ApiTags('Admin – Inventory Transfers')
@ApiBearerAuth()
@Controller('admin/inventory/transfers')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class InventoryTransfersAdminController {
    constructor(
        private inventoryService: InventoryService,
        private transferService: InventoryTransferService,
    ) {}

    private async resolveTenantIdForList(
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        branchId?: number,
    ) {
        if (user.tenantId != null) return user.tenantId;
        if (branchId != null) {
            return this.inventoryService.resolveTenantId(user, branchId);
        }
        throw new BadRequestException(
            'Super admin must provide branch_id for transfer list endpoints',
        );
    }

    @Get('requests')
    async listRequests(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
            permissions?: string[];
        },
        @Query('branch_id') branchId?: string,
        @Query('scope') scope?: string,
    ) {
        const tenantId = await this.resolveTenantIdForList(
            user,
            branchId ? Number(branchId) : undefined,
        );
        return this.transferService.listRequests(
            user,
            tenantId,
            scope === 'mine' || scope === 'incoming' ? scope : undefined,
        );
    }

    /**
     * Read-only reference lists (tenant-level item master + UOMs) needed to build
     * a transfer request. Exposed under the transfers prefix so brand admins — who
     * cannot reach /admin/inventory/items|uoms (those also host writes) — can still
     * populate the request form.
     */
    @Get('reference/items')
    async referenceItems(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Query('branch_id') branchId?: string,
    ) {
        const tenantId = await this.resolveTenantIdForList(
            user,
            branchId ? Number(branchId) : undefined,
        );
        return this.inventoryService.listItems(tenantId);
    }

    @Get('reference/uoms')
    async referenceUoms(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Query('branch_id') branchId?: string,
    ) {
        const tenantId = await this.resolveTenantIdForList(
            user,
            branchId ? Number(branchId) : undefined,
        );
        return this.inventoryService.listUoms(tenantId);
    }

    @Post('requests')
    createRequest(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            source_branch_id: number;
            destination_branch_id: number;
            source_brand_id?: number | null;
            destination_brand_id?: number | null;
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                requested_qty: number;
                requested_uom_id: number;
                notes?: string;
            }>;
        },
    ) {
        return this.transferService.createRequest(user, dto);
    }

    @Post('requests/:id/approve')
    approveRequest(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body() dto: { notes?: string },
    ) {
        return this.transferService.approveRequest(user, +id, dto.notes);
    }

    @Post('requests/:id/reject')
    rejectRequest(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body() dto: { reason?: string },
    ) {
        return this.transferService.rejectRequest(user, +id, dto.reason);
    }

    @Get('orders')
    async listOrders(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
            permissions?: string[];
        },
        @Query('branch_id') branchId?: string,
        @Query('scope') scope?: string,
    ) {
        const tenantId = await this.resolveTenantIdForList(
            user,
            branchId ? Number(branchId) : undefined,
        );
        return this.transferService.listOrders(
            user,
            tenantId,
            scope === 'mine' || scope === 'incoming' ? scope : undefined,
        );
    }

    @Post('orders/:id/dispatch')
    dispatchOrder(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body()
        dto: {
            lines: Array<{
                inventory_item_id: number;
                qty: number;
                qty_uom_id: number;
                location_id?: number | null;
                inventory_batch_id?: number | null;
                notes?: string | null;
            }>;
        },
    ) {
        return this.transferService.dispatchOrder(user, +id, dto);
    }

    @Post('orders/:id/receive')
    receiveOrder(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body()
        dto: {
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                received_qty: number;
                received_uom_id: number;
                location_id?: number | null;
                lot_code?: string | null;
                expiry_date?: string | null;
                notes?: string | null;
            }>;
        },
    ) {
        return this.transferService.receiveOrder(user, +id, dto);
    }
}
