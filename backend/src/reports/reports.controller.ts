import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Reports')
@ApiBearerAuth()
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class ReportsController {
    constructor(private service: ReportsService) {}

    @Get('day-overview')
    dayOverview(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.dayOverview(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
        );
    }

    @Get('sales-summary')
    salesSummary(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.salesSummary(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
        );
    }

    @Get('top-items')
    topItems(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
        @Query('limit') limit: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.topItems(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                limit: limit ? +limit : 10,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
        );
    }

    @Get('shift-summary')
    shiftSummary(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.shiftSummary(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
        );
    }
}
