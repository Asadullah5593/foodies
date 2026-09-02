import {
    BadRequestException,
    Controller,
    Get,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { RequirePermission } from '../roles/require-permission.decorator';
import { Permissions } from '../roles/permissions.dto';
import { normalizePakistaniPhone } from '../utils/phone';
import { CustomerAddressesService } from './customer-addresses.service';

@ApiTags('POS')
@ApiBearerAuth()
@Controller('pos/customers')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class PosCustomerAddressesController {
    constructor(private readonly addresses: CustomerAddressesService) {}

    /**
     * Where this number has had deliveries before, so the order taker can offer
     * "the same place as last time?" instead of asking for it again.
     *
     * Behind its own permission because a complete number is all it takes to
     * learn where somebody lives. The number must be complete for the same
     * reason — a partial one would let the till be walked through the customer
     * book a prefix at a time.
     */
    @Get('addresses')
    @RequirePermission(Permissions.ORDERS_CUSTOMER_ADDRESSES_VIEW)
    @ApiQuery({ name: 'phone', required: true })
    async addressesForPhone(
        @CurrentUser()
        user: {
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Query('phone') phone: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        const normalized = normalizePakistaniPhone(phone ?? '');
        if (!normalized) {
            throw new BadRequestException(
                'Enter the customer’s complete mobile number.',
            );
        }
        const addresses = await this.addresses.listForPhone(
            user.tenantId,
            normalized,
            user.allowedBrandIds ?? null,
        );
        return { phone: normalized, addresses };
    }
}
