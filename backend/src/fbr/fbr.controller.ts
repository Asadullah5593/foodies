import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Param,
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
import { FbrService } from './fbr.service';

@ApiTags('Admin – FBR')
@ApiBearerAuth()
@Controller('admin/fbr')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class FbrController {
    constructor(private service: FbrService) {}

    /** Per-branch FBR overview (Business Settings panel). Tenant users only. */
    @Get('status')
    status(@CurrentUser() user: { id: number; tenantId: number | null }) {
        if (user.tenantId == null) {
            throw new ForbiddenException(
                'FBR settings are for tenant users only',
            );
        }
        return this.service.getStatus(user.tenantId);
    }

    /**
     * The "all branches at once" admin button: rewrites every branch's own
     * fbr_enabled flag. Enabling skips branches missing credentials.
     */
    @Post('bulk-toggle')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_MANAGE)
    bulkToggle(
        @Body() dto: { enabled: boolean },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (user.tenantId == null) {
            throw new ForbiddenException(
                'FBR settings are for tenant users only',
            );
        }
        return this.service.bulkSetEnabled(user.tenantId, dto.enabled === true);
    }

    /** Post a dummy invoice to FBR with the branch's saved credentials. */
    @Post('branches/:id/test-connection')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCHES_MANAGE)
    testConnection(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.testConnection(+id, user.tenantId);
    }
}
