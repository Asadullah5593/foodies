import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtUser } from '../auth/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { ActNotificationDto } from './notification-act.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class NotificationsController {
    constructor(private readonly service: NotificationsService) {}

    @Get('open')
    @ApiOperation({
        summary: 'List my open notifications (catch-up on connect)',
    })
    open(@CurrentUser() user: JwtUser) {
        return this.service.listOpenForUser(user.id);
    }

    @Get('unread-count')
    @ApiOperation({ summary: 'My unread open notification count (bell badge)' })
    async unreadCount(@CurrentUser() user: JwtUser) {
        return { count: await this.service.unreadCount(user.id) };
    }

    @Post(':id/act')
    @ApiOperation({
        summary: 'Perform a terminal action on a notification (resolves it)',
    })
    act(
        @Param('id') id: string,
        @CurrentUser() user: JwtUser,
        @Body() dto: ActNotificationDto,
    ) {
        return this.service.act(+id, user.id, dto.action_key);
    }

    @Post(':id/read')
    @ApiOperation({
        summary: 'Mark a notification read (clears the bell badge)',
    })
    read(@Param('id') id: string, @CurrentUser() user: JwtUser) {
        return this.service.markRead(+id, user.id);
    }

    @Post('read-all')
    @ApiOperation({ summary: 'Mark all my notifications read' })
    readAll(@CurrentUser() user: JwtUser) {
        return this.service.markAllRead(user.id);
    }
}
