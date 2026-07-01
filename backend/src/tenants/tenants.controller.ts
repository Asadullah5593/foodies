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
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Tenants')
@ApiBearerAuth()
@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class TenantsController {
    constructor(private service: TenantsService) {}

    /** Only super admin can list tenants. Tenant users use GET /admin/business-settings */
    @Get()
    index(@CurrentUser() user: { id: number; tenantId: number | null }) {
        if (user.tenantId != null) {
            throw new ForbiddenException(
                'Only super admin can access the tenants list',
            );
        }
        return this.service.findAllForAdmin(user.tenantId);
    }

    /** Only super admin can show any tenant by id. Tenant users use GET /admin/business-settings */
    @Get(':id')
    show(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId != null) {
            throw new ForbiddenException(
                'Only super admin can view tenants. Use Business Settings to view your business details.',
            );
        }
        return this.service.findOneForAdmin(+id, user.tenantId);
    }

    @Get(':id/loyalty-settings')
    getLoyaltySettings(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.getLoyaltySettings(+id, user.tenantId);
    }

    @Put(':id/loyalty-settings')
    updateLoyaltySettings(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            loyalty_enabled?: boolean;
            display_name?: string;
            spend_per_point?: number;
            min_order_to_earn?: number;
            cash_value_per_point?: number;
            min_order_to_redeem?: number;
            expiry_period?: number;
            expiry_unit?: 'day' | 'month' | 'year';
        },
    ) {
        return this.service.updateLoyaltySettings(+id, user.tenantId, dto);
    }

    @Post()
    store(
        @Body()
        dto: {
            name: string;
            slug?: string;
            status?: string;
            legal_name?: string;
            default_currency?: string;
            default_timezone?: string;
            loyalty_enabled?: boolean;
            owner_email: string;
            owner_password: string;
            owner_name?: string;
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId != null)
            throw new ForbiddenException('Only super admin can create tenants');
        return this.service.create(dto);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            slug?: string;
            status?: string;
            legal_name?: string;
            default_currency?: string;
            default_timezone?: string;
            loyalty_enabled?: boolean;
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId != null) {
            throw new ForbiddenException(
                'Only super admin can update tenants. Use Business Settings to update your business details.',
            );
        }
        return this.service.updateForAdmin(+id, user.tenantId, dto);
    }

    @Delete(':id')
    destroy(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId != null) {
            throw new ForbiddenException('Only super admin can delete tenants');
        }
        return this.service.removeForAdmin(+id, user.tenantId);
    }
}
