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
import { BankCardsService } from './bank-cards.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

type CardUser = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};
type CardBody = {
    name?: string;
    bank?: string | null;
    network?: string | null;
    bin_prefixes?: string[] | null;
    eligibility_brand_ids?: number[] | null;
    eligibility_branch_ids?: number[] | null;
    /** The card's own discount — omit/null for a card that discounts nothing. */
    discount_type?: 'flat' | 'percentage' | null;
    discount_value?: number | null;
    min_order_amount?: number | null;
    max_discount_amount?: number | null;
    valid_from?: string | null;
    valid_until?: string | null;
    valid_time_start?: string | null;
    valid_time_end?: string | null;
    valid_days_of_week?: number[] | null;
    is_active?: boolean;
};

@ApiTags('Admin – Bank Cards')
@ApiBearerAuth()
@Controller('admin/bank-cards')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class BankCardsController {
    constructor(private service: BankCardsService) {}

    /** POS + admin: list the tenant's cards. `?active=1` returns only active ones (for the POS picker). */
    @Get()
    index(@CurrentUser() user: CardUser, @Query('active') active?: string) {
        return this.service.findAll(
            user.tenantId,
            active === '1' || active === 'true',
            user.allowedBrandIds,
        );
    }

    /**
     * BIN lookup (POS + admin): does the card starting with these digits carry
     * a discount? `branch_id` (optional) evaluates time-of-day/day windows in
     * that branch's timezone.
     */
    @Get('lookup')
    lookup(
        @CurrentUser() user: CardUser,
        @Query('bin') bin: string,
        @Query('branch_id') branchId?: string,
    ) {
        return this.service.lookupByBin(
            user.tenantId,
            bin,
            user.allowedBrandIds,
            branchId && Number.isFinite(+branchId) ? +branchId : null,
        );
    }

    @Post()
    @RequirePermission(Permissions.BANK_CARDS_CREATE)
    store(@CurrentUser() user: CardUser, @Body() body: CardBody) {
        if (user.tenantId == null)
            throw new ForbiddenException('Bank cards are managed per tenant');
        return this.service.create(user.tenantId, body, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.BANK_CARDS_EDIT)
    update(
        @CurrentUser() user: CardUser,
        @Param('id') id: string,
        @Body() body: CardBody,
    ) {
        if (user.tenantId == null)
            throw new ForbiddenException('Bank cards are managed per tenant');
        return this.service.update(
            +id,
            user.tenantId,
            body,
            user.allowedBrandIds,
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.BANK_CARDS_DELETE)
    remove(@CurrentUser() user: CardUser, @Param('id') id: string) {
        if (user.tenantId == null)
            throw new ForbiddenException('Bank cards are managed per tenant');
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}
