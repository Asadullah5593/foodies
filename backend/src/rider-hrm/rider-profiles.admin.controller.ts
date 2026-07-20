import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { RiderHrmService } from './rider-hrm.service';

@ApiTags('Admin – Rider HRM – Profiles')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class RiderProfilesAdminController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

    @Post('profiles')
    @RequirePermission(Permissions.RIDER_PROFILES_EDIT)
    upsertProfile(
        @CurrentUser()
        user: { tenantId: number | null; allowedBrandIds?: number[] | null },
        @Body()
        dto: {
            user_id: number;
            employment_status?: string;
            salary_type?: string;
            employee_code?: string;
            base_salary?: number;
            default_per_ride_commission?: number;
            max_active_orders?: number;
            min_rating?: number;
            min_timely_rate?: number;
            is_active?: boolean;
            metadata?: Record<string, unknown>;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.upsertRiderProfile(
            user.tenantId,
            dto,
            user.allowedBrandIds,
        );
    }

    @Get('profiles')
    listProfiles(
        @CurrentUser()
        user: {
            tenantId: number | null;
            allowedBrandIds?: number[] | null;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listRiderProfiles(
            user.tenantId,
            user.allowedBrandIds,
        );
    }
}
