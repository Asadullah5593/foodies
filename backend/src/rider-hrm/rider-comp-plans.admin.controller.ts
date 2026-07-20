import {
    BadRequestException,
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
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { RiderHrmService } from './rider-hrm.service';

@ApiTags('Admin – Rider HRM – Compensation Plans')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class RiderCompPlansAdminController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

    @Post('comp-plans')
    @RequirePermission(Permissions.RIDER_COMP_PLANS_CREATE)
    createCompPlan(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            name: string;
            pay_method: string;
            branch_id?: number;
            effective_from?: string;
            effective_to?: string;
            components: Array<{
                component_key: string;
                name: string;
                component_type: string;
                calc_basis: string;
                value: number;
                conditions?: Record<string, unknown>;
                is_enabled?: boolean;
                sort_order?: number;
            }>;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.createCompPlan(user.tenantId, user.id, dto);
    }

    @Get('comp-plans')
    listCompPlans(
        @CurrentUser() user: { tenantId: number | null },
        @Query('branch_id') branchId: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listCompPlans(
            user.tenantId,
            branchId ? +branchId : undefined,
        );
    }

    @Patch('comp-plans/:id/activate')
    @RequirePermission(Permissions.RIDER_COMP_PLANS_ACTIVATE)
    activateCompPlan(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.activateCompPlan(
            +id,
            user.tenantId,
            user.id,
        );
    }

    @Get('comp-plans/:id')
    getCompPlan(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.getCompPlan(+id, user.tenantId);
    }
}
