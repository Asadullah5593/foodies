import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CouponsService } from './coupons.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

type User = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Coupons')
@ApiBearerAuth()
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class CouponsController {
    constructor(private service: CouponsService) {}

    @Get()
    index(@CurrentUser() user: User) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds);
    }

    /** POS: all vouchers a customer holds (by phone), any status. */
    @Get('customer-vouchers')
    customerVouchers(@CurrentUser() user: User, @Query('phone') phone: string) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.customerVouchers(user.tenantId, phone ?? '');
    }

    @Post()
    @RequirePermission(Permissions.COUPONS_CREATE)
    store(@CurrentUser() user: User, @Body() dto: Record<string, unknown>) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(dto, user.tenantId, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.COUPONS_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: Record<string, unknown>,
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(
            +id,
            user.tenantId,
            dto,
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.COUPONS_DELETE)
    destroy(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }

    @Post(':id/issue-vouchers')
    @RequirePermission(Permissions.COUPONS_EDIT)
    issue(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: { customer_ids: number[] },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.issueVouchers(
            +id,
            user.tenantId,
            dto.customer_ids ?? [],
            user.allowedBrandIds,
        );
    }

    @Get(':id/vouchers')
    vouchers(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.listVouchers(
            +id,
            user.tenantId,
            user.allowedBrandIds,
        );
    }

    @Get(':id/report')
    report(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.report(+id, user.tenantId, user.allowedBrandIds);
    }
}
