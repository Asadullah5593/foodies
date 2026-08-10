import {
    ArrayNotEmpty,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
} from 'class-validator';

/**
 * Request body for POST /public/consumer/payments/session.
 *
 * These are the same cart fields the app sends to place an order. Notably it
 * does NOT declare `payment_split` or `bank_card_id` — with the global
 * ValidationPipe (whitelist: true) any such client-sent fields are stripped, so
 * the customer cannot force the cash GST rate or inject a card-linked discount.
 * Tender is set to full-card server-side. `items` stays untyped so the global
 * pipe doesn't recurse into (and strip) the nested addon/modifier/deal
 * structure — createOrder validates the items deeply.
 */
export class CreatePaymentSessionDto {
    @IsInt()
    branch_id: number;

    @IsString()
    @IsNotEmpty()
    order_type: string;

    @IsArray()
    @ArrayNotEmpty()
    items: unknown[];

    @IsOptional()
    @IsString()
    table_number?: string;

    @IsOptional()
    @IsString()
    customer_name?: string;

    @IsOptional()
    @IsString()
    customer_phone?: string;

    @IsOptional()
    @IsInt()
    customer_id?: number;

    @IsOptional()
    @IsString()
    delivery_address?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString()
    discount_code?: string;

    @IsOptional()
    @IsNumber()
    loyalty_points_to_redeem?: number;

    @IsOptional()
    @IsNumber()
    latitude?: number;

    @IsOptional()
    @IsNumber()
    longitude?: number;

    @IsOptional()
    @IsNumber()
    branch_latitude?: number;

    @IsOptional()
    @IsNumber()
    branch_longitude?: number;

    @IsOptional()
    @IsString()
    delivery_tier?: string;
}
