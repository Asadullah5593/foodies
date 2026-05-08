import {
    Controller,
    Get,
    Patch,
    Body,
    Param,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiOkResponse,
    ApiParam,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RiderAuthGuard } from '../auth/rider-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Rider – Orders')
@ApiBearerAuth()
@Controller('rider/orders')
@UseGuards(JwtAuthGuard, RiderAuthGuard)
export class RiderOrdersController {
    constructor(private service: OrdersService) {}

    @Get()
    @ApiOperation({ summary: 'List orders assigned to the logged-in rider' })
    @ApiOkResponse({
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'number' },
                    order_number: { type: 'string' },
                    order_group_id: { type: 'string', nullable: true },
                    status: { type: 'string' },
                    delivery_status: { type: 'string', nullable: true },
                    delivery_failed_reason: { type: 'string', nullable: true },
                    customer_name: { type: 'string', nullable: true },
                    customer_phone: { type: 'string', nullable: true },
                    delivery_address: { type: 'string', nullable: true },
                    delivery_latitude: { type: 'number', nullable: true },
                    delivery_longitude: { type: 'number', nullable: true },
                    branch_latitude: { type: 'number', nullable: true },
                    branch_longitude: { type: 'number', nullable: true },
                    placed_at: { type: 'string', nullable: true },
                    total_amount: { type: 'number' },
                    branch: {
                        type: 'object',
                        nullable: true,
                        properties: {
                            id: { type: 'number' },
                            name: { type: 'string' },
                            address: { type: 'string', nullable: true },
                            latitude: { type: 'number', nullable: true },
                            longitude: { type: 'number', nullable: true },
                        },
                    },
                    brand_name: { type: 'string', nullable: true },
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'number' },
                                name_snapshot: {
                                    type: 'string',
                                    nullable: true,
                                },
                                quantity: { type: 'number' },
                                unit_price: { type: 'number' },
                            },
                        },
                    },
                },
            },
        },
    })
    index(@CurrentUser() user: { id: number }) {
        return this.service.findAllForRider(user.id);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a single order assigned to the rider' })
    @ApiParam({ name: 'id', example: 1 })
    @ApiOkResponse({
        schema: {
            type: 'object',
            properties: {
                id: { type: 'number' },
                order_number: { type: 'string' },
                order_group_id: { type: 'string', nullable: true },
                status: { type: 'string' },
                delivery_status: { type: 'string', nullable: true },
                delivery_failed_reason: { type: 'string', nullable: true },
                customer_name: { type: 'string', nullable: true },
                customer_phone: { type: 'string', nullable: true },
                delivery_address: { type: 'string', nullable: true },
                delivery_latitude: { type: 'number', nullable: true },
                delivery_longitude: { type: 'number', nullable: true },
                branch_latitude: { type: 'number', nullable: true },
                branch_longitude: { type: 'number', nullable: true },
                placed_at: { type: 'string', nullable: true },
                total_amount: { type: 'number' },
                branch: {
                    type: 'object',
                    nullable: true,
                    properties: {
                        id: { type: 'number' },
                        name: { type: 'string' },
                        address: { type: 'string', nullable: true },
                        latitude: { type: 'number', nullable: true },
                        longitude: { type: 'number', nullable: true },
                    },
                },
                brand_name: { type: 'string', nullable: true },
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'number' },
                            name_snapshot: { type: 'string', nullable: true },
                            quantity: { type: 'number' },
                            unit_price: { type: 'number' },
                            addons: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: {
                                            type: 'string',
                                            nullable: true,
                                        },
                                        quantity: { type: 'number' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    show(@Param('id') id: string, @CurrentUser() user: { id: number }) {
        return this.service.findForRider(+id, user.id);
    }

    @Patch(':id/status')
    updateDeliveryStatus(
        @Param('id') id: string,
        @CurrentUser() user: { id: number },
        @Body()
        body: { delivery_status: string; delivery_failed_reason?: string },
    ) {
        const deliveryStatus = body?.delivery_status;
        if (!deliveryStatus || typeof deliveryStatus !== 'string') {
            throw new BadRequestException('delivery_status is required');
        }
        return this.service.updateDeliveryStatus(
            +id,
            user.id,
            deliveryStatus.trim(),
            body?.delivery_failed_reason,
        );
    }
}
