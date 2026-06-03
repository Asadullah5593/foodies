import {
    BadRequestException,
    Controller,
    Get,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RiderHrmService } from './rider-hrm.service';

@ApiTags('Admin – Rider HRM – Presence (On-Duty)')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class RiderPresenceAdminController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

    @Get('on-duty')
    listOnDuty(
        @CurrentUser() user: { tenantId: number | null },
        @Query('branch_id') branchId: string,
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException('Tenant context required');
        }
        return this.riderHrmService.listOnDuty(
            user.tenantId,
            branchId ? +branchId : undefined,
        );
    }
}
