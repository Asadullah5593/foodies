import {
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    Param,
    Put,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { RequirePermission } from '../roles/require-permission.decorator';
import { Permissions } from '../roles/permissions.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtUser } from '../auth/current-user.decorator';
import { NotificationSettingsService } from './notification-settings.service';
import { UpsertNotificationSettingDto } from './notification-settings.dto';

@ApiTags('Admin – Notification Settings')
@ApiBearerAuth()
@Controller('admin/notification-settings')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class NotificationSettingsController {
    constructor(private readonly service: NotificationSettingsService) {}

    @Get()
    @ApiOperation({ summary: 'List the event catalog + this tenant overrides' })
    @RequirePermission(Permissions.NOTIFICATIONS_VIEW)
    list(@CurrentUser() user: JwtUser) {
        if (!user.tenantId) {
            throw new ForbiddenException(
                'Only tenant users can configure notifications',
            );
        }
        return this.service.list(user.tenantId);
    }

    @Put()
    @ApiOperation({ summary: 'Create/update a role-targeting override' })
    @RequirePermission(Permissions.NOTIFICATIONS_EDIT)
    upsert(
        @CurrentUser() user: JwtUser,
        @Body() dto: UpsertNotificationSettingDto,
    ) {
        if (!user.tenantId) {
            throw new ForbiddenException(
                'Only tenant users can configure notifications',
            );
        }
        return this.service.upsert(user.tenantId, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete an override (revert to default)' })
    @RequirePermission(Permissions.NOTIFICATIONS_EDIT)
    remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
        if (!user.tenantId) {
            throw new ForbiddenException(
                'Only tenant users can configure notifications',
            );
        }
        return this.service.remove(user.tenantId, +id);
    }
}
