import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { DesignationsService } from './designations.service';
import { HrAuditService } from './hr-audit.service';
import { DesignationDto } from './dto/hr-support.dto';
import type { HrUser } from './employee-scope';

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/settings/designations')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class DesignationsController {
    constructor(private readonly designations: DesignationsService) {}

    /**
     * Readable with `employees:view`, not just `hr-settings:manage` — every
     * employee form needs the list to render its designation picker, and a
     * branch manager who can open a staff record must be able to see what the
     * title means.
     */
    @Get()
    @RequirePermission(Permissions.EMPLOYEES_VIEW)
    list(@CurrentUser() user: HrUser, @Query('include_inactive') inc?: string) {
        return this.designations.list(user, inc === '1' || inc === 'true');
    }

    @Post()
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    create(@CurrentUser() user: HrUser, @Body() dto: DesignationDto) {
        return this.designations.create(user, dto);
    }

    @Put(':id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    update(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: DesignationDto,
    ) {
        return this.designations.update(user, id, dto);
    }

    @Delete(':id')
    @RequirePermission(Permissions.HR_SETTINGS_MANAGE)
    @ApiOperation({
        summary: 'Delete a designation',
        description:
            'Deactivates instead of deleting when any assignment references it — past assignments must keep resolving or the employment history breaks.',
    })
    remove(@CurrentUser() user: HrUser, @Param('id', ParseIntPipe) id: number) {
        return this.designations.remove(user, id);
    }
}

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/audit')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class HrAuditController {
    constructor(private readonly audit: HrAuditService) {}

    @Get()
    @RequirePermission(Permissions.HR_AUDIT_VIEW)
    @ApiOperation({
        summary: 'HR audit trail',
        description:
            'Append-only record of salary changes, exits, document handling and (from Phase 2) PIN resets and attendance overrides.',
    })
    list(
        @CurrentUser() user: HrUser,
        @Query('entity_table') entityTable?: string,
        @Query('entity_id') entityId?: string,
        @Query('limit') limit?: string,
    ) {
        return this.audit.list(user.tenantId, {
            entityTable,
            entityId: entityId ? Number(entityId) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }
}
