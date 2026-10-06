import {
    BadRequestException,
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrintedVouchersService } from './printed-vouchers.service';
import type { PrintedVoucherDto } from './printed-vouchers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

type VoucherUser = {
    id: number;
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Printed Vouchers')
@ApiBearerAuth()
@Controller('admin/printed-vouchers')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class PrintedVouchersController {
    constructor(private service: PrintedVouchersService) {}

    @Get()
    @RequirePermission(Permissions.PRINTED_VOUCHERS_VIEW)
    index(@CurrentUser() user: VoucherUser) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds);
    }

    /**
     * The till's buttons. Gated on `apply`, not `view`: a cashier applies a
     * voucher without any access to the admin page.
     */
    @Get('for-till')
    @RequirePermission(Permissions.PRINTED_VOUCHERS_APPLY)
    forTill(
        @CurrentUser() user: VoucherUser,
        @Query('branch_id') branchId?: string,
        @Query('brand_id') brandId?: string,
        @Query('order_type') orderType?: string,
    ) {
        return this.service.findForTill(user.tenantId, user.allowedBrandIds, {
            branchId: branchId ? Number(branchId) : null,
            brandId: brandId ? Number(brandId) : null,
            orderType: orderType ?? null,
        });
    }

    /** Pick-lists for the form: one brand's categories, products, options, branches. */
    @Get('form-options')
    @RequirePermission(
        Permissions.PRINTED_VOUCHERS_CREATE,
        Permissions.PRINTED_VOUCHERS_EDIT,
    )
    formOptions(
        @CurrentUser() user: VoucherUser,
        @Query('brand_id') brandId?: string,
    ) {
        if (!brandId) throw new BadRequestException('brand_id is required');
        return this.service.formOptions(
            user.tenantId,
            Number(brandId),
            user.allowedBrandIds,
        );
    }

    /** Which vouchers were redeemed, where, when and by whom. */
    @Get('report')
    @RequirePermission(Permissions.PRINTED_VOUCHERS_VIEW)
    report(
        @CurrentUser() user: VoucherUser,
        @Query('date_from') dateFrom?: string,
        @Query('date_to') dateTo?: string,
        @Query('branch_id') branchId?: string,
        @Query('brand_id') brandId?: string,
        @Query('voucher_id') voucherId?: string,
    ) {
        return this.service.report(
            user.tenantId,
            {
                date_from: dateFrom,
                date_to: dateTo,
                branch_id: branchId ? Number(branchId) : undefined,
                brand_id: brandId ? Number(brandId) : undefined,
                voucher_id: voucherId ? Number(voucherId) : undefined,
            },
            user.allowedBranchIds,
            user.allowedBrandIds,
        );
    }

    @Post()
    @RequirePermission(Permissions.PRINTED_VOUCHERS_CREATE)
    store(@CurrentUser() user: VoucherUser, @Body() body: PrintedVoucherDto) {
        return this.service.create(user.tenantId, body, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.PRINTED_VOUCHERS_EDIT)
    update(
        @CurrentUser() user: VoucherUser,
        @Param('id') id: string,
        @Body() body: PrintedVoucherDto,
    ) {
        return this.service.update(
            +id,
            user.tenantId,
            body,
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.PRINTED_VOUCHERS_DELETE)
    remove(@CurrentUser() user: VoucherUser, @Param('id') id: string) {
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
