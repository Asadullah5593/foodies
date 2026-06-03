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
import { RiderHrmService } from './rider-hrm.service';

@ApiTags('Admin – Rider HRM – Payroll')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class RiderPayrollAdminController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

    @Post('payroll/runs')
    runPayroll(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            from: string;
            to: string;
            branch_id?: number;
            timely_minutes?: number;
            expected_monthly_minutes?: number;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.runPayroll(user.tenantId, user.id, dto);
    }

    @Get('payroll/runs')
    listPayrollRuns(
        @CurrentUser() user: { tenantId: number | null },
        @Query('branch_id') branchId: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listPayrollRuns(
            user.tenantId,
            branchId ? +branchId : undefined,
        );
    }

    @Get('payroll/runs/:id')
    getPayrollRun(
        @Param('id') id: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.getPayrollRun(+id, user.tenantId);
    }

    @Post('payroll/runs/:id/reverse')
    reversePayrollRun(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.reversePayrollRun(
            +id,
            user.tenantId,
            user.id,
        );
    }
}
