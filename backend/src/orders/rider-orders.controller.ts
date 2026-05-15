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
    ApiBody,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RiderAuthGuard } from '../auth/rider-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RiderDeliveryStatusDto } from './dto/rider-delivery-status.dto';

@ApiTags('Rider – Orders')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
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
    @ApiOperation({
        summary: 'Update delivery status for an order assigned to this rider',
        description:
            'Only orders where `rider_id` matches the authenticated rider may be updated. When setting `delivery_failed`, `delivery_failed_reason` is required.',
    })
    @ApiParam({ name: 'id', example: 100, description: 'Order ID' })
    @ApiBody({
        type: RiderDeliveryStatusDto,
        examples: {
            pickedUp: {
                summary: 'Picked up from restaurant',
                value: { delivery_status: 'picked_up' },
            },
            delivered: {
                summary: 'Delivered to customer',
                value: { delivery_status: 'delivered' },
            },
            failed: {
                summary: 'Delivery failed (reason required)',
                value: {
                    delivery_status: 'delivery_failed',
                    delivery_failed_reason: 'Customer not available',
                },
            },
        },
    })
    updateDeliveryStatus(
        @Param('id') id: string,
        @CurrentUser() user: { id: number },
        @Body() body: RiderDeliveryStatusDto,
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
