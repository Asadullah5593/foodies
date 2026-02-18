import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Reports')
@ApiBearerAuth()
@Controller('admin/reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
    constructor(private service: ReportsService) {}

    @Get('sales-summary')
    salesSummary(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('branch_id') branchId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.salesSummary(user.tenantId, {
            branch_id: branchId ? +branchId : undefined,
            date_from: dateFrom,
            date_to: dateTo,
        });
    }

    @Get('top-items')
    topItems(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('branch_id') branchId: string,
        @Query('limit') limit: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.topItems(user.tenantId, {
            branch_id: branchId ? +branchId : undefined,
            limit: limit ? +limit : 10,
            date_from: dateFrom,
            date_to: dateTo,
        });
    }

    @Get('shift-summary')
    shiftSummary(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('branch_id') branchId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.shiftSummary(user.tenantId, {
            branch_id: branchId ? +branchId : undefined,
            date_from: dateFrom,
            date_to: dateTo,
        });
    }
}
