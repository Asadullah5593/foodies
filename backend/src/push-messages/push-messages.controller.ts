import {
    Body,
    Controller,
    Delete,
    Get,
    Header,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { PushMessagesService } from './push-messages.service';
import type { PushUser, SaveMessageBody } from './push-messages.service';
import { PushSettingsService } from './push-settings.service';
import type { PushSettingsDto } from './push-settings.service';
import type {
    AudienceSpec,
    PerCustomer,
    RepeatRule,
    ScheduleType,
} from './push-message.types';

const VIEW = Permissions.PUSH_NOTIFICATIONS_VIEW;
const SEND = Permissions.PUSH_NOTIFICATIONS_SEND;
const SETTINGS = Permissions.PUSH_NOTIFICATIONS_SETTINGS;

/**
 * Admin push notifications to app customers. Bodies are plain types checked
 * in the service (the audience and repeat rules are nested, data-driven
 * shapes), as in the printed-vouchers controller.
 */
@ApiTags('Admin – Push Notifications')
@ApiBearerAuth()
@Controller('admin/push-notifications')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class PushMessagesController {
    constructor(
        private readonly service: PushMessagesService,
        private readonly settings: PushSettingsService,
    ) {}

    /** Rules, picker options, placeholders and settings for the composer. */
    @Get('meta')
    @RequirePermission(VIEW)
    meta(@CurrentUser() user: PushUser) {
        return this.service.meta(user);
    }

    @Get('overview')
    @RequirePermission(VIEW)
    overview(@CurrentUser() user: PushUser) {
        return this.service.overview(user);
    }

    /** Live "640 match → 214 have the app → 231 phones" while building. */
    @Post('audience/preview')
    @RequirePermission(VIEW)
    previewAudience(
        @CurrentUser() user: PushUser,
        @Body()
        body: {
            audience?: AudienceSpec;
            audience_id?: number | null;
            skip_order_in_progress?: boolean;
            respect_cap?: boolean;
            message_id?: number | null;
            per_customer?: PerCustomer;
            per_customer_days?: number | null;
        },
    ) {
        return this.service.previewAudience(user, body);
    }

    /** The next sends of a schedule, read on the business's clock. */
    @Post('schedule/preview')
    @RequirePermission(VIEW)
    previewSchedule(
        @CurrentUser() user: PushUser,
        @Body()
        body: {
            schedule_type?: ScheduleType;
            send_at?: string | null;
            repeat?: RepeatRule | null;
            skip_dates?: string[];
            runs_count?: number;
        },
    ) {
        return this.service.previewSchedule(user, body);
    }

    @Post('test')
    @RequirePermission(SEND)
    test(
        @CurrentUser() user: PushUser,
        @Body()
        body: {
            title?: string;
            body?: string;
            image_url?: string | null;
            expiry_hours?: number;
            replace_previous?: boolean;
            phones?: string[];
        },
    ) {
        return this.service.testSend(user, body);
    }

    // —— messages ——

    @Get('messages')
    @RequirePermission(VIEW)
    list(
        @CurrentUser() user: PushUser,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.list(user, {
            status,
            search,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }

    @Get('messages/:id')
    @RequirePermission(VIEW)
    detail(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.detail(user, id);
    }

    @Get('messages/:id/recipients')
    @RequirePermission(VIEW)
    recipients(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
        @Query('run_id') runId?: string,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.recipients(user, id, {
            run_id: runId ? Number(runId) : undefined,
            status,
            search,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
    }

    @Get('messages/:id/recipients.csv')
    @RequirePermission(VIEW)
    @Header('Content-Type', 'text/csv; charset=utf-8')
    @Header('Content-Disposition', 'attachment; filename="push-recipients.csv"')
    recipientsCsv(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
        @Query('run_id') runId?: string,
        @Query('status') status?: string,
    ) {
        return this.service.recipientsCsv(user, id, {
            run_id: runId ? Number(runId) : undefined,
            status,
        });
    }

    @Post('messages')
    @RequirePermission(SEND)
    create(@CurrentUser() user: PushUser, @Body() body: SaveMessageBody) {
        return this.service.create(user, body);
    }

    @Put('messages/:id')
    @RequirePermission(SEND)
    update(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() body: SaveMessageBody,
    ) {
        return this.service.update(user, id, body);
    }

    @Post('messages/:id/pause')
    @RequirePermission(SEND)
    pause(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.pause(user, id);
    }

    @Post('messages/:id/resume')
    @RequirePermission(SEND)
    resume(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.resume(user, id);
    }

    @Post('messages/:id/cancel')
    @RequirePermission(SEND)
    cancel(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.cancel(user, id);
    }

    @Post('messages/:id/skip-next')
    @RequirePermission(SEND)
    skipNext(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.skipNext(user, id);
    }

    @Post('messages/:id/duplicate')
    @RequirePermission(SEND)
    duplicate(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.duplicate(user, id);
    }

    @Delete('messages/:id')
    @RequirePermission(SEND)
    remove(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.remove(user, id);
    }

    // —— saved audiences ——

    @Get('audiences')
    @RequirePermission(VIEW)
    audiences(@CurrentUser() user: PushUser) {
        return this.service.listAudiences(user);
    }

    @Post('audiences')
    @RequirePermission(SEND)
    createAudience(
        @CurrentUser() user: PushUser,
        @Body()
        body: {
            name?: string;
            description?: string | null;
            rules?: AudienceSpec;
            brand_id?: number | null;
        },
    ) {
        return this.service.saveAudience(user, body);
    }

    @Put('audiences/:id')
    @RequirePermission(SEND)
    updateAudience(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
        @Body()
        body: {
            name?: string;
            description?: string | null;
            rules?: AudienceSpec;
            brand_id?: number | null;
        },
    ) {
        return this.service.saveAudience(user, body, id);
    }

    @Delete('audiences/:id')
    @RequirePermission(SEND)
    deleteAudience(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.deleteAudience(user, id);
    }

    // —— templates ——

    @Get('templates')
    @RequirePermission(VIEW)
    templates(@CurrentUser() user: PushUser) {
        return this.service.listTemplates(user);
    }

    @Post('templates')
    @RequirePermission(SEND)
    createTemplate(
        @CurrentUser() user: PushUser,
        @Body()
        body: {
            name?: string;
            title?: string;
            body?: string;
            image_url?: string | null;
            brand_id?: number | null;
        },
    ) {
        return this.service.saveTemplate(user, body);
    }

    @Put('templates/:id')
    @RequirePermission(SEND)
    updateTemplate(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
        @Body()
        body: {
            name?: string;
            title?: string;
            body?: string;
            image_url?: string | null;
            brand_id?: number | null;
        },
    ) {
        return this.service.saveTemplate(user, body, id);
    }

    @Delete('templates/:id')
    @RequirePermission(SEND)
    deleteTemplate(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.deleteTemplate(user, id);
    }

    // —— settings ——

    @Get('settings')
    @RequirePermission(VIEW)
    async getSettings(@CurrentUser() user: PushUser) {
        const v = this.service.viewer(user);
        return this.settings.toDto(await this.settings.get(v.tenantId));
    }

    @Put('settings')
    @RequirePermission(SETTINGS)
    updateSettings(
        @CurrentUser() user: PushUser,
        @Body() body: Partial<PushSettingsDto>,
    ) {
        const v = this.service.viewer(user);
        return this.settings.update(v.tenantId, user.id, body);
    }

    /** Re-read the phone list from Firebase now. */
    @Post('devices/sync')
    @RequirePermission(SETTINGS)
    syncDevices(@CurrentUser() user: PushUser) {
        return this.service.syncDevices(user);
    }

    // —— one customer ——

    @Get('customers/:id')
    @RequirePermission(VIEW)
    customer(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.customerHistory(user, id);
    }

    /** "Stop promo notifications" for a customer who asked; order updates are unaffected. */
    @Put('customers/:id/opt-out')
    @RequirePermission(SEND)
    optOut(
        @CurrentUser() user: PushUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() body: { opt_out?: boolean },
    ) {
        return this.service.setOptOut(user, id, Boolean(body?.opt_out));
    }
}
