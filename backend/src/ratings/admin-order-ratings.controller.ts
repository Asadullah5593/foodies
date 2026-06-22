import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiOkResponse,
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
            'Does not include customer ids or phones. Rider and per-brand ratings may include optional `comment` text from the customer. `public_rating_*` fields are all-time brand aggregates (same as consumer brand listings).',
    })
    @ApiParam({
        name: 'id',
        description: 'Order id',
        example: 1001,
        type: Number,
    })
    @ApiOkResponse({
        description:
            'Anonymous ratings for this order. Rider block uses `comment`; each brand row uses `order_comment` for optional customer text.',
        schema: {
            type: 'object',
            properties: {
                rider_rating: {
                    type: 'object',
                    nullable: true,
                    properties: {
                        stars: { type: 'integer', minimum: 1, maximum: 5 },
                        comment: { type: 'string', nullable: true },
                        rated_at: {
                            type: 'string',
                            format: 'date-time',
                            nullable: true,
                        },
                    },
                },
                brand_ratings: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            brand_id: { type: 'integer' },
                            brand_name: { type: 'string', nullable: true },
                            order_stars: { type: 'integer' },
                            order_comment: { type: 'string', nullable: true },
                            order_rated_at: {
                                type: 'string',
                                format: 'date-time',
                                nullable: true,
                            },
                            public_rating_average: {
                                type: 'number',
                                nullable: true,
                            },
                            public_rating_count: { type: 'integer' },
                        },
                    },
                },
            },
        },
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
