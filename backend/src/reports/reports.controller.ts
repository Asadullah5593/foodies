import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

type ReportsUser = {
    id: number;
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Reports')
@ApiBearerAuth()
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class ReportsController {
    constructor(private service: ReportsService) {}

    @Get('day-overview')
    dayOverview(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.dayOverview(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get('sales-summary')
    salesSummary(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.salesSummary(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get('top-items')
    topItems(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('limit') limit: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.topItems(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                limit: limit ? +limit : 10,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    /**
     * Product-wise sales: every menu item sold in the window with quantity,
     * gross / net sales and its share, filterable by date, branch, brand and
     * category, with a child split by variant, branch or brand.
     */
    @Get('product-sales')
    productSales(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('category_id') categoryId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
        @Query('time_from') timeFrom: string,
        @Query('time_to') timeTo: string,
        @Query('status') status: string,
        @Query('discount') discount: string,
        @Query('split_by') splitBy: string,
        @Query('sort_by') sortBy: string,
        @Query('sort_dir') sortDir: string,
        @Query('limit') limit: string,
    ) {
        const splits = ['variant', 'branch', 'brand', 'none'] as const;
        const sorts = [
            'quantity',
            'gross_sales',
            'net_sales',
            'orders',
            'name',
        ] as const;
        type Split = (typeof splits)[number];
        type Sort = (typeof sorts)[number];
        return this.service.productSales(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                category_id: categoryId ? +categoryId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
                time_from: timeFrom,
                time_to: timeTo,
                status: status || undefined,
                discount: discount || undefined,
                split_by: splits.includes(splitBy as Split)
                    ? (splitBy as Split)
                    : undefined,
                sort_by: sorts.includes(sortBy as Sort)
                    ? (sortBy as Sort)
                    : undefined,
                sort_dir: sortDir === 'asc' ? 'asc' : 'desc',
                limit: limit ? +limit : undefined,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    /** Order-wise trend: per-order points (capped) + uncapped totals (all-status count, completed-only revenue). */
    @Get('order-series')
    orderSeries(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('limit') limit: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
        @Query('time_from') timeFrom: string,
        @Query('time_to') timeTo: string,
    ) {
        return this.service.orderSeries(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                limit: limit ? +limit : 200,
                date_from: dateFrom,
                date_to: dateTo,
                time_from: timeFrom,
                time_to: timeTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    /** Where the discounts went: split by offer type, and by card for bank-funded ones. */
    @Get('discounts')
    discounts(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.discountsBreakdown(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get('dashboard-summary')
    dashboardSummary(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
        @Query('time_from') timeFrom: string,
        @Query('time_to') timeTo: string,
    ) {
        return this.service.dashboardSummary(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
                time_from: timeFrom,
                time_to: timeTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get('recent-orders')
    recentOrders(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('limit') limit: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
        @Query('time_from') timeFrom: string,
        @Query('time_to') timeTo: string,
    ) {
        return this.service.recentOrders(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                limit: limit ? +limit : 15,
                date_from: dateFrom,
                date_to: dateTo,
                time_from: timeFrom,
                time_to: timeTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get('inventory-alerts')
    inventoryAlerts(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.inventoryAlerts(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
        );
    }

    @Get('shift-summary')
    shiftSummary(
        @CurrentUser() user: ReportsUser,
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
    ) {
        return this.service.shiftSummary(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                date_from: dateFrom,
                date_to: dateTo,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }
}
