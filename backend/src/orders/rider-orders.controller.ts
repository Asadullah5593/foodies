import {
    Controller,
    Get,
    Patch,
    Body,
    Param,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
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
    index(@CurrentUser() user: { id: number }) {
        return this.service.findAllForRider(user.id);
    }

    @Get(':id')
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
