import {
    Controller,
    Get,
    Put,
    Body,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Business Settings')
@ApiBearerAuth()
@Controller('admin/business-settings')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BusinessSettingsController {
    constructor(private service: TenantsService) {}

    /** Tenant users get their own business details. Super admin has no tenant and gets 403. */
    @Get()
    get(@CurrentUser() user: { id: number; tenantId: number | null }) {
        if (user.tenantId == null) {
            throw new ForbiddenException(
                'Business settings are for tenant users only',
            );
        }
        return this.service.getBusinessSettings(user.tenantId);
    }

    /** Tenant users update their own business details. Currency (PKR) and timezone are fixed and not exposed. */
    @Put()
    update(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            name?: string;
            legal_name?: string;
            gst_rate_cash?: number | null;
            gst_rate_card?: number | null;
            loyalty_enabled?: boolean;
            auto_print_invoices?: boolean;
        },
    ) {
        if (user.tenantId == null) {
            throw new ForbiddenException(
                'Business settings are for tenant users only',
            );
        }
        return this.service.updateBusinessSettings(user.tenantId, dto);
    }
}
