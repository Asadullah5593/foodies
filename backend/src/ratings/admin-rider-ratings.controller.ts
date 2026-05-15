import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RatingsService } from './ratings.service';

@ApiTags('Admin – Rider ratings')
@ApiBearerAuth()
@Controller('admin/riders')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class AdminRiderRatingsController {
    constructor(private readonly ratingsService: RatingsService) {}

    @Get(':userId/ratings')
    @ApiOperation({
        operationId: 'admin_listRiderStarRatings',
        summary: 'List customer star ratings for a rider (admin only)',
        description:
            'Paginated rider ratings (stars + order refs + optional customer `comment` when provided). `userId` is the **rider staff user id** (`users.id`), not an order id. ' +
            'Tenant users only see ratings tied to orders in their tenant. `limit` and `offset` are optional.',
    })
    @ApiParam({
        name: 'userId',
        description:
            '**Rider user id** (numeric `users.id` for the delivery staff). Not an order id.',
        example: 55,
        type: Number,
    })
    @ApiQuery({
        name: 'limit',
        required: false,
        description: 'Page size (default 50, max 100).',
        schema: { type: 'integer', default: 50, minimum: 1, maximum: 100 },
    })
    @ApiQuery({
        name: 'offset',
        required: false,
        description: 'Number of rows to skip for pagination (default 0).',
        schema: { type: 'integer', default: 0, minimum: 0 },
    })
    @ApiOkResponse({
        description: 'Paginated rider star ratings; each item may include an optional customer `comment`.',
        schema: {
            type: 'object',
            required: ['items', 'total', 'limit', 'offset'],
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['id', 'order_id', 'order_number', 'stars', 'order_item_ids', 'created_at'],
                        properties: {
                            id: { type: 'integer' },
                            order_id: { type: 'integer' },
                            order_number: { type: 'string' },
                            stars: { type: 'integer', minimum: 1, maximum: 5 },
                            comment: {
                                type: 'string',
                                nullable: true,
                                description: 'Optional customer comment for this rider rating.',
                            },
                            order_item_ids: {
                                type: 'array',
                                items: { type: 'integer' },
                            },
                            created_at: { type: 'string', format: 'date-time' },
                        },
                    },
                },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
            },
        },
    })
    listRatings(
        @Param('userId') userId: string,
        @Query('limit') limitParam: string,
        @Query('offset') offsetParam: string,
        @CurrentUser() user: { tenantId: number | null },
    ) {
        const riderUserId = +userId;
        if (!Number.isFinite(riderUserId)) {
            throw new BadRequestException('Invalid rider user id');
        }
        const limit = Math.min(
            100,
            Math.max(1, parseInt(limitParam ?? '50', 10) || 50),
        );
        const offset = Math.max(0, parseInt(offsetParam ?? '0', 10) || 0);
        return this.ratingsService.listRiderRatingsForAdmin(
            riderUserId,
            user.tenantId,
            { limit, offset },
        );
    }
}
