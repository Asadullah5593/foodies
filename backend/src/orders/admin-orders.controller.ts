import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    Query,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Orders')
@ApiBearerAuth()
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class AdminOrdersController {
    constructor(private service: OrdersService) {}

    @Get('riders')
    listRiders(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Query('brand_id') brandId?: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Riders are listed per tenant; super admin must specify tenant context',
            );
        }
        return this.service.listRiders(
            user.tenantId,
            user.allowedBrandIds,
            brandId ? +brandId : undefined,
        );
    }

    @Put('group/:orderGroupId/rider')
    assignRiderToGroup(
        @Param('orderGroupId') orderGroupId: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() body: { rider_id: number },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Assign rider to group is only available for tenant users',
            );
        }
        const riderId = body?.rider_id;
        if (riderId == null || typeof riderId !== 'number') {
            throw new BadRequestException('rider_id is required');
        }
        return this.service.assignRiderToGroup(
            orderGroupId,
            user.tenantId,
            riderId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Put('group/:orderGroupId/rider/change')
    changeRiderForGroup(
        @Param('orderGroupId') orderGroupId: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() body: { rider_id: number },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Change rider for group is only available for tenant users',
            );
        }
        const riderId = body?.rider_id;
        if (riderId == null || typeof riderId !== 'number') {
            throw new BadRequestException('rider_id is required');
        }
        return this.service.changeRiderForGroup(
            orderGroupId,
            user.tenantId,
            riderId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get()
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
        @Query('brand_id') brandId: string,
        @Query('status') status: string,
        @Query('order_type') orderType: string,
        @Query('source') source: string,
        @Query('date_from') dateFrom: string,
        @Query('date_to') dateTo: string,
        @Query('has_rider') hasRider: string,
    ) {
        return this.service.findAllAdmin(
            user.tenantId,
            {
                branch_id: branchId ? +branchId : undefined,
                brand_id: brandId ? +brandId : undefined,
                status,
                order_type: orderType || undefined,
                source: source || undefined,
                date_from: dateFrom,
                date_to: dateTo,
                has_rider:
                    hasRider === '1' || hasRider === 'true' ? true : undefined,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Get(':id')
    show(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return this.service.findForAdmin(
            +id,
            user.tenantId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Put(':id/status')
    updateStatus(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() body: { status: string },
    ) {
        return this.service.updateStatus(
            +id,
            user.tenantId,
            body.status,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Put(':id/rider')
    assignRider(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() body: { rider_id: number },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Assign rider is only available for tenant users',
            );
        }
        const riderId = body?.rider_id;
        if (riderId == null || typeof riderId !== 'number') {
            throw new BadRequestException('rider_id is required');
        }
        return this.service.assignRider(
            +id,
            user.tenantId,
            riderId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Put(':id/rider/change')
    changeRider(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() body: { rider_id: number },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Change rider is only available for tenant users',
            );
        }
        const riderId = body?.rider_id;
        if (riderId == null || typeof riderId !== 'number') {
            throw new BadRequestException('rider_id is required');
        }
        return this.service.changeRider(
            +id,
            user.tenantId,
            riderId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Post(':id/auto-assign')
    retryAutoAssign(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Automatic assignment retry is only available for tenant users',
            );
        }
        return this.service.retryAutoAssignForAdmin(
            +id,
            user.tenantId,
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }
}
