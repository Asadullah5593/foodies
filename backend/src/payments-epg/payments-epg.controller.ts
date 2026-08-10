import {
    Body,
    Controller,
    Get,
    NotFoundException,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalCustomerJwtAuthGuard } from '../auth/optional-customer-jwt-auth.guard';
import { CreatePaymentSessionDto } from './dto/create-payment-session.dto';
import { EpgService } from './epg.service';

/**
 * App-facing online-card payment endpoints (Meezan EPG).
 *
 * Flow: POST /session (cart) -> we return a `form_url` the app opens in a
 * WebView -> customer pays -> app polls GET /session/:token until `paid`.
 * The status endpoint is the source of truth; the return redirect is never
 * trusted for payment confirmation.
 */
@ApiTags('consumer-payments')
@Controller('public/consumer/payments')
export class PaymentsEpgController {
    constructor(private readonly epgService: EpgService) {}

    @Post('session')
    @UseGuards(OptionalCustomerJwtAuthGuard)
    @ApiOperation({
        summary:
            'Start an online card payment. Prices the cart as card tender, ' +
            'registers with the bank, and returns a hosted payment page URL. ' +
            'The order is NOT created until payment is confirmed.',
    })
    async createSession(
        @Req() req: { user?: { id?: number } | null },
        @Body() dto: CreatePaymentSessionDto,
    ) {
        return this.epgService.createSession({
            cart: dto as unknown as Record<string, unknown>,
            customerId: req.user?.id ?? null,
        });
    }

    @Get('session/:token')
    @UseGuards(OptionalCustomerJwtAuthGuard)
    @ApiOperation({
        summary:
            'Get payment status by session token. Polls the bank on demand ' +
            'when still pending. This is the ONLY source of truth for whether ' +
            'the payment succeeded — never the return redirect.',
    })
    async getSession(@Param('token') token: string) {
        const view = await this.epgService.getSessionView(token);
        if (!view) throw new NotFoundException('Payment session not found');
        return view;
    }
}
