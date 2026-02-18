import {
    Controller,
    Get,
    Patch,
    Body,
    Param,
    Query,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { KitchenService } from './kitchen.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Kitchen (KDS)')
@ApiBearerAuth()
@Controller('kitchen')
@UseGuards(JwtAuthGuard)
export class KitchenController {
    constructor(private kitchenService: KitchenService) {}

    @Get('orders')
    listOrders(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('branch_id') branchIdParam: string,
        @Query('station_id') stationIdParam: string,
        @Query('status') status: string,
        @Query('category_id') categoryIdParam: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : null;
        if (!branchId) throw new ForbiddenException('branch_id is required');
        return this.kitchenService.listOrders(branchId, {
            station_id: stationIdParam ? +stationIdParam : undefined,
            status: status || undefined,
            category_id: categoryIdParam ? +categoryIdParam : undefined,
        });
    }

    @Get('orders/:id')
    getOrder(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('branch_id') branchIdParam: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : null;
        if (!branchId) throw new ForbiddenException('branch_id is required');
        return this.kitchenService.getOrder(+id, branchId);
    }

    @Patch('orders/:id/status')
    updateStatus(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body() body: { status: string; branch_id: number },
    ) {
        const branchId = body.branch_id ?? null;
        if (!branchId) throw new ForbiddenException('branch_id is required');
        return this.kitchenService.updateStatus(+id, branchId, body.status);
    }

    @Get('orders/:id/kot')
    getKot(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Query('branch_id') branchIdParam: string,
    ) {
        const branchId = branchIdParam ? +branchIdParam : null;
        if (!branchId) throw new ForbiddenException('branch_id is required');
        return this.kitchenService.getKotPayload(+id, branchId);
    }
}
