import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiBody,
    ApiOkResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RiderAuthGuard } from '../auth/rider-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RiderOrderLocationService } from './rider-order-location.service';

@ApiTags('Rider – Order location')
@ApiBearerAuth()
@Controller('rider/orders')
@UseGuards(JwtAuthGuard, RiderAuthGuard)
export class RiderOrderLocationController {
    constructor(private readonly locationService: RiderOrderLocationService) {}

    @Post(':id/location')
    @ApiOperation({
        summary: 'Record rider GPS for an assigned order (append-only)',
    })
    @ApiParam({ name: 'id', description: 'Order id' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['latitude', 'longitude'],
            properties: {
                latitude: { type: 'number', example: 31.5204 },
                longitude: { type: 'number', example: 74.3587 },
            },
        },
    })
    @ApiOkResponse({
        schema: {
            type: 'object',
            required: ['latitude', 'longitude', 'recorded_at'],
            properties: {
                latitude: { type: 'number', example: 31.5204 },
                longitude: { type: 'number', example: 74.3587 },
                recorded_at: {
                    type: 'string',
                    format: 'date-time',
                    example: '2026-05-04T12:00:00.000Z',
                },
            },
        },
    })
    record(
        @Param('id') id: string,
        @Body() body: { latitude: number; longitude: number },
        @CurrentUser() user: { id: number },
    ) {
        return this.locationService.recordForRider(
            +id,
            user.id,
            body?.latitude,
            body?.longitude,
        );
    }
}
