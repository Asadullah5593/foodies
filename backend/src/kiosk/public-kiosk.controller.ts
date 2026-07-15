import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { KioskService } from './kiosk.service';
import { KioskApiKeyGuard } from './kiosk-api-key.guard';
import { KioskOrderPayload } from '../entities/kiosk-order.entity';

/**
 * Public endpoint the Flutter-web kiosk calls to submit a "pay at counter" cart.
 * Secured by a shared `x-kiosk-api-key` header. Stores the cart as PENDING and
 * returns a short code — it does NOT create a real order yet.
 */
@ApiTags('Kiosk – Public')
@ApiSecurity('kiosk-api-key')
@Controller('public/kiosk')
@UseGuards(KioskApiKeyGuard)
export class PublicKioskController {
    private readonly logger = new Logger(PublicKioskController.name);

    constructor(private readonly kioskService: KioskService) {}

    @Post('orders')
    @ApiOperation({ summary: 'Submit a kiosk pay-at-counter cart' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['branch_id', 'order_type', 'items'],
            properties: {
                branch_id: { type: 'number' },
                order_type: { type: 'string', enum: ['dine_in', 'takeaway'] },
                customer_name: { type: 'string' },
                customer_phone: { type: 'string' },
                discount_code: { type: 'string' },
                notes: { type: 'string' },
                idempotency_key: { type: 'string' },
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            menu_item_id: { type: 'number' },
                            deal_menu_item_id: { type: 'number' },
                            quantity: { type: 'number' },
                            variant_id: { type: 'number' },
                            addons: { type: 'array' },
                            modifiers: { type: 'array' },
                            notes: { type: 'string' },
                        },
                    },
                },
            },
        },
    })
    async submit(
        @Body()
        body: KioskOrderPayload & { idempotency_key?: string },
    ) {
        try {
            return await this.kioskService.submit(
                body,
                body.idempotency_key ?? null,
            );
        } catch (e) {
            // A rejected submit leaves no row, so without this a kiosk that shows
            // the customer a code regardless is indistinguishable from one that
            // never called at all — the cart simply never exists and the counter
            // gets "no such order".
            this.logger.warn(
                `Kiosk submit REJECTED for branch ${body?.branch_id}: ${(e as Error).message}`,
            );
            throw e;
        }
    }
}
