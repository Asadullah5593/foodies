import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    UseGuards,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';
import { BranchesService } from '../branches/branches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

/**
 * A call-centre agent takes orders through this same POS API, so we tag their
 * orders with their own source (instead of the walk-in `pos`) — this both
 * surfaces them as a distinct "Call centre" source in the Orders module and
 * makes the till chime for them (walk-in `pos` orders are skipped). The agent's
 * role carries the marker permission below; every other POS user falls back to
 * plain `pos`. The client cannot set the source itself — it is derived server-
 * side from who is placing the order.
 */
const CALL_CENTRE_PLACE_PERMISSION = 'orders:place:call-center';

function resolvePosSource(user: {
    permissions?: string[];
}): 'pos' | 'call_centre' {
    return user.permissions?.includes(CALL_CENTRE_PLACE_PERMISSION)
        ? 'call_centre'
        : 'pos';
}

@ApiTags('POS – Orders')
@ApiBearerAuth()
@Controller('pos/orders')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class PosOrdersController {
    constructor(
        private ordersService: OrdersService,
        private paymentsService: PaymentsService,
        private branchesService: BranchesService,
    ) {}

    private async resolveTenantId(
        user: { tenantId: number | null; isSuperAdmin?: boolean },
        branchId: number,
    ): Promise<number> {
        if (user.tenantId != null) return user.tenantId;
        if (user.isSuperAdmin === true) {
            const tenantId =
                await this.branchesService.getPrimaryTenantId(branchId);
            if (tenantId == null)
                throw new NotFoundException('Branch has no tenant');
            return tenantId;
        }
        throw new ForbiddenException('Tenant context required for POS orders');
    }

    @Post('quote')
    async quote(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBrandIds?: number[] | null;
            allowedBranchIds?: number[] | null;
            permissions?: string[];
            staffDiscountCeiling?: {
                maxPercent: number | null;
                maxAmount: number | null;
            };
        },
        @Body()
        dto: {
            branch_id: number;
            order_type: string;
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                modifiers?: { modifier_id: number; quantity?: number }[];
            }[];
            discount_code?: string;
            customer_phone?: string;
            loyalty_points_to_redeem?: number;
            payment_split?: { cash_amount?: number; card_amount?: number };
            bank_card_id?: number | null;
            staff_discount_id?: number | null;
            manual_offer_id?: number | null;
        },
    ) {
        const tenantId = await this.resolveTenantId(user, dto.branch_id);
        return this.ordersService.quote(
            dto,
            tenantId,
            resolvePosSource(user),
            user.allowedBrandIds ?? null,
            user,
        );
    }

    @Post()
    async store(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBrandIds?: number[] | null;
            allowedBranchIds?: number[] | null;
            permissions?: string[];
            staffDiscountCeiling?: {
                maxPercent: number | null;
                maxAmount: number | null;
            };
        },
        @Body()
        dto: {
            branch_id: number;
            order_type: string;
            table_number?: string;
            customer_name?: string;
            customer_phone?: string;
            delivery_address?: string;
            /** Drop-off coordinates from the cashier's Google Places pick. */
            latitude?: number;
            longitude?: number;
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                modifiers?: { modifier_id: number; quantity?: number }[];
                notes?: string;
                /** If present, this line is fulfilled by this branch (for multi-branch carts). Otherwise uses request branch_id. */
                branch_id?: number;
            }[];
            notes?: string;
            discount_code?: string;
            loyalty_points_to_redeem?: number;
            payment_split?: { cash_amount?: number; card_amount?: number };
            bank_card_id?: number | null;
            /** Staff discount preset granted at the till (staff_discounts id). */
            staff_discount_id?: number | null;
            /** Till-activated offer switched on for this cart (discounts id). */
            manual_offer_id?: number | null;
            /** Optional idempotency key so a retried/double-tapped placement is deduped. */
            idempotency_key?: string;
        },
    ) {
        const tenantId = await this.resolveTenantId(user, dto.branch_id);
        return this.ordersService.createOrder(
            dto,
            tenantId,
            user.id,
            resolvePosSource(user),
            null,
            user.allowedBrandIds ?? null,
            dto.idempotency_key ?? null,
            user,
        );
    }

    @Get('group/:orderGroupId')
    getOrderGroup(@Param('orderGroupId') orderGroupId: string) {
        return this.ordersService.getOrderGroup(orderGroupId);
    }

    @Get('group/:orderGroupId/main-invoice')
    getOrderGroupMainInvoice(@Param('orderGroupId') orderGroupId: string) {
        return this.ordersService.getOrderGroupMainInvoice(orderGroupId);
    }

    @Get(':id')
    show(@Param('id') id: string) {
        return this.ordersService.findOne(+id);
    }

    @Get(':id/invoice')
    getOrderInvoice(
        @Param('id') id: string,
        @Query('purpose') purpose?: string,
    ) {
        return this.ordersService.getOrderInvoice(
            +id,
            purpose === 'kitchen' ? 'kitchen' : 'customer',
        );
    }

    @Post(':id/pay')
    async pay(
        @Param('id') id: string,
        @Body()
        dto: {
            payment_method: string;
            amount: number;
            reference_number?: string;
            /** Optional key so a retried/double-submitted tender is recorded once. */
            idempotency_key?: string;
        },
    ) {
        return this.paymentsService.processPayment(
            +id,
            dto.payment_method,
            dto.amount,
            dto.reference_number,
            dto.idempotency_key ?? null,
        );
    }
}
