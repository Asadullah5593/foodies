import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RatingsService } from './ratings.service';

@ApiTags('Admin – Orders')
@ApiBearerAuth()
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class AdminOrderRatingsController {
    constructor(private readonly ratingsService: RatingsService) {}

    @Get(':id/ratings')
    @ApiOperation({
        operationId: 'admin_getOrderRatings',
        summary: 'Customer star ratings for this order (admin)',
        description:
            'Returns **anonymous** star data for this order only: rider delivery rating (if any) and per-brand order ratings (if any). ' +
            'Does not include customer ids, phones, or written reviews. `public_rating_*` fields are all-time brand aggregates (same as consumer brand listings).',
    })
    @ApiParam({
        name: 'id',
        description: 'Order id',
        example: 1001,
        type: Number,
    })
    getOrderRatings(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
    ) {
        return this.ratingsService.getOrderRatingsForAdmin(
            +id,
            user.tenantId,
            user.allowedBranchIds,
        );
    }
}
