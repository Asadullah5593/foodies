import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

/** PATCH /api/rider/orders/:id/status — JSON body. */
export class RiderDeliveryStatusDto {
    @ApiProperty({
        example: 'picked_up',
        description:
            'Next delivery lifecycle status. Allowed: `accepted`, `picked_up`, `delivered`, `delivery_failed`.',
        enum: ['accepted', 'picked_up', 'delivered', 'delivery_failed'],
    })
    @IsString()
    @IsIn(['accepted', 'picked_up', 'delivered', 'delivery_failed'], {
        message:
            'delivery_status must be one of: accepted, picked_up, delivered, delivery_failed',
    })
    delivery_status: string;

    @ApiPropertyOptional({
        example: 'Customer not available',
        description:
            'Required when `delivery_status` is `delivery_failed`; ignored otherwise.',
    })
    @IsOptional()
    @IsString()
    delivery_failed_reason?: string;
}
