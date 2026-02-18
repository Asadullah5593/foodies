import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';
import { BranchesService } from '../branches/branches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('POS – Orders')
@ApiBearerAuth()
@Controller('pos/orders')
@UseGuards(JwtAuthGuard)
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
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            branch_id: number;
            order_type: string;
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
            }[];
            discount_code?: string;
            customer_phone?: string;
            loyalty_points_to_redeem?: number;
        },
    ) {
        const tenantId = await this.resolveTenantId(user, dto.branch_id);
        return this.ordersService.quote(dto, tenantId, 'pos');
    }

    @Post()
    async store(
        @CurrentUser()
        user: { id: number; tenantId: number | null; isSuperAdmin?: boolean },
        @Body()
        dto: {
            branch_id: number;
            order_type: string;
            table_number?: string;
            customer_name?: string;
            customer_phone?: string;
            delivery_address?: string;
            items: {
                menu_item_id: number;
                quantity: number;
                variant_id?: number;
                addons?: { addon_id: number; quantity?: number }[];
                notes?: string;
                /** If present, this line is fulfilled by this branch (for multi-branch carts). Otherwise uses request branch_id. */
                branch_id?: number;
            }[];
            notes?: string;
            discount_code?: string;
            loyalty_points_to_redeem?: number;
        },
    ) {
        const tenantId = await this.resolveTenantId(user, dto.branch_id);
        return this.ordersService.createOrder(dto, tenantId, user.id, 'pos');
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
    getOrderInvoice(@Param('id') id: string) {
        return this.ordersService.getOrderInvoice(+id);
    }

    @Post(':id/pay')
    async pay(
        @Param('id') id: string,
        @Body()
        dto: {
            payment_method: string;
            amount: number;
            reference_number?: string;
        },
    ) {
        return this.paymentsService.processPayment(
            +id,
            dto.payment_method,
            dto.amount,
            dto.reference_number,
        );
    }
}
