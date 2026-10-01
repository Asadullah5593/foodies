import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { restrictedOrderSources } from '../orders/order-source-restriction';
import { withoutSecrets } from './customer-secrets';

/**
 * The viewer, as RoleAccessGuard enriches them. The order figures beside a
 * customer are computed inside this scope — the same one the Orders module
 * applies — so they never count an order the viewer could not open there.
 */
type CustomerViewer = {
    id: number;
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    allowedBrandIds?: number[] | null;
    orderHistoryDays?: number | null;
    permissions?: string[] | null;
};

/**
 * `orders:view:no-totals` takes money aggregates away from an account. A
 * customer's lifetime spend is one, so it is withheld server-side, not just
 * hidden in the page.
 */
function hidesOrderTotals(user: CustomerViewer): boolean {
    return (user.permissions ?? []).includes(Permissions.ORDERS_VIEW_NO_TOTALS);
}

@ApiTags('Admin – Customers')
@ApiBearerAuth()
@Controller('admin/customers')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class CustomersController {
    constructor(private service: CustomersService) {}

    @Get()
    index(@CurrentUser() user: CustomerViewer) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds, {
            allowedBranchIds: user.allowedBranchIds,
            orderHistoryDays: user.orderHistoryDays,
            restrictedSources: restrictedOrderSources(user),
            hideTotals: hidesOrderTotals(user),
        });
    }

    /** The customer detail page: figures plus the brand + branch breakdown. */
    @Get(':id/summary')
    summary(@Param('id') id: string, @CurrentUser() user: CustomerViewer) {
        return this.service.getSummary(
            +id,
            {
                tenantId: user.tenantId,
                allowedBranchIds: user.allowedBranchIds,
                allowedBrandIds: user.allowedBrandIds,
                orderHistoryDays: user.orderHistoryDays,
                restrictedSources: restrictedOrderSources(user),
            },
            hidesOrderTotals(user),
        );
    }

    @Get(':id')
    async show(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        return withoutSecrets(
            await this.service.findOne(
                +id,
                user.tenantId,
                user.allowedBrandIds,
            ),
        );
    }

    @Post()
    @RequirePermission(Permissions.CUSTOMERS_CREATE)
    async store(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() dto: { phone: string; name: string; link?: boolean },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        // Linking hands back an EXISTING customer, who may well have a login.
        return withoutSecrets(
            await this.service.create(
                user.tenantId,
                dto,
                user.allowedBrandIds,
                dto.link,
            ),
        );
    }

    @Put(':id')
    @RequirePermission(Permissions.CUSTOMERS_EDIT)
    async update(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
        @Body() dto: { name?: string },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return withoutSecrets(
            await this.service.update(
                +id,
                user.tenantId,
                dto,
                user.allowedBrandIds,
            ),
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.CUSTOMERS_DELETE)
    async remove(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        await this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
