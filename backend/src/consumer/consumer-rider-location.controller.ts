import {
    Controller,
    Get,
    Param,
    Query,
    NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { RiderOrderLocationService } from '../orders/rider-order-location.service';

@ApiTags('Consumer')
@Controller('public/consumer')
export class ConsumerRiderLocationController {
    constructor(
        private readonly riderOrderLocationService: RiderOrderLocationService,
    ) {}

    @Get('orders/:id/rider-location')
    @ApiOperation({
        summary: 'Latest stored rider coordinates for an order (polling)',
    })
    @ApiParam({ name: 'id', description: 'Order id' })
    @ApiQuery({
        name: 'phone',
        required: true,
        description: 'Customer phone (same as order placement)',
        example: '03001234567',
    })
    getLatest(@Param('id') id: string, @Query('phone') phone: string) {
        if (!phone?.trim()) {
            throw new NotFoundException('phone is required');
        }
        return this.riderOrderLocationService.getLatestForCustomerPhone(
            +id,
            phone.trim(),
        );
    }
}
