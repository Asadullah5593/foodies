import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProcurementService } from './procurement.service';

@ApiTags('Admin – Procurement')
@ApiBearerAuth()
@Controller('admin/procurement')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class ProcurementAdminController {
    constructor(private procurementService: ProcurementService) {}

    // PR
    @Get('purchase-requisitions')
    async listPRs(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
        },
    ) {
        const tenantId =
            await this.procurementService.resolveTenantIdForList(user);
        return this.procurementService.listPRs(tenantId);
    }

    @Post('purchase-requisitions')
    async createPR(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            pr_number?: string;
            requesting_branch_id: number;
            requested_from_vendor_id: number;
            notes?: string;
            lines: Array<{
                inventory_item_id: number;
                requested_qty: number;
                requested_uom_id: number;
                notes?: string;
            }>;
        },
    ) {
        return this.procurementService.createPR(user, dto);
    }

    @Patch('purchase-requisitions/:id')
    async updatePR(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBranchIds?: number[] | null;
        },
        @Param('id') id: string,
        @Body()
        dto: {
            pr_number?: string;
            requesting_branch_id?: number;
            requested_from_vendor_id?: number;
            notes?: string | null;
            lines?: Array<{
                inventory_item_id: number;
                requested_qty: number;
                requested_uom_id: number;
                notes?: string | null;
            }>;
        },
    ) {
        return this.procurementService.updatePR(user, +id, dto);
    }

    @Post('purchase-requisitions/:id/submit')
    submitPR(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        return this.procurementService.submitPR(user, +id);
    }

    @Post('purchase-requisitions/:id/approve')
    approvePR(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body()
        dto: {
            po_number?: string;
            expected_delivery_date?: string | null;
            notes?: string | null;
        },
    ) {
        return this.procurementService.approvePRAndCreatePO({
            user,
            prId: +id,
            ...dto,
        });
    }

    @Post('purchase-requisitions/:id/reject')
    rejectPR(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body() dto: { reason?: string },
    ) {
        return this.procurementService.rejectPR(user, +id, dto.reason);
    }

    // PO
    @Get('purchase-orders')
    async listPOs(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Query('status') status?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        const tenantId =
            await this.procurementService.resolveTenantIdForList(user);
        return this.procurementService.listPOs(tenantId, { status, from, to });
    }

    @Get('purchase-orders/:id')
    async getPO(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        const tenantId =
            await this.procurementService.resolveTenantIdForList(user);
        return this.procurementService.getPO(tenantId, +id);
    }

    @Patch('purchase-orders/:id')
    updatePO(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBranchIds?: number[] | null;
        },
        @Param('id') id: string,
        @Body()
        dto: {
            po_number?: string;
            vendor_id?: number;
            notes?: string | null;
            lines?: Array<{
                inventory_item_id: number;
                ordered_qty: number;
                ordered_uom_id: number;
                notes?: string | null;
            }>;
        },
    ) {
        return this.procurementService.updatePO(user, +id, dto);
    }

    // GRN
    @Get('grns')
    async listGRNs(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Query('status') status?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        const tenantId =
            await this.procurementService.resolveTenantIdForList(user);
        return this.procurementService.listGRNs(tenantId, { status, from, to });
    }

    @Get('grns/:id')
    async getGRNById(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        const tenantId =
            await this.procurementService.resolveTenantIdForList(user);
        return this.procurementService.getGRN(tenantId, +id);
    }

    @Post('grns')
    createGRN(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            grn_number?: string;
            purchase_order_id: number;
            branch_id: number;
            notes?: string;
        },
    ) {
        return this.procurementService.createGRN(user, dto);
    }

    @Patch('grns/:id')
    updateGRN(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body()
        dto: {
            grn_number?: string;
            notes?: string | null;
            lines?: Array<{
                line_id?: number;
                purchase_order_line_id?: number | null;
                inventory_item_id: number;
                received_qty: number;
                accepted_qty?: number | null;
                rejected_qty?: number | null;
                rejection_reason?: string | null;
                allow_mismatched_item?: boolean;
                received_uom_id: number;
                lot_code?: string | null;
                expiry_date?: string | null;
                location_id?: number | null;
                notes?: string | null;
            }>;
        },
    ) {
        return this.procurementService.updateGRN(user, +id, dto);
    }

    @Post('grns/:id/lines')
    addGRNLine(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
        @Body()
        dto: {
            purchase_order_line_id?: number | null;
            inventory_item_id: number;
            received_qty: number;
            accepted_qty?: number | null;
            rejected_qty?: number | null;
            rejection_reason?: string | null;
            allow_mismatched_item?: boolean;
            received_uom_id: number;
            lot_code?: string | null;
            expiry_date?: string | null;
            location_id?: number | null;
            notes?: string | null;
        },
    ) {
        return this.procurementService.addGRNLine(user, +id, dto);
    }

    @Post('grns/:id/post')
    postGRN(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        return this.procurementService.postGRN(user, +id);
    }

    @Post('grns/:id/reverse')
    reverseGRN(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Param('id') id: string,
    ) {
        return this.procurementService.reverseGRN(user, +id);
    }
}
