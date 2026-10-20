import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { PushMessage } from '../entities/push-message.entity';
import { PushAudience } from '../entities/push-audience.entity';
import { PushTemplate } from '../entities/push-template.entity';
import { PushSettings } from '../entities/push-settings.entity';
import { PushMessagesController } from './push-messages.controller';
import { PushMessagesService } from './push-messages.service';
import { PushSettingsService } from './push-settings.service';
import { PushAudienceService } from './push-audience.service';
import { PushDeviceSyncService } from './push-device-sync.service';
import { PushSenderService } from './push-sender.service';
import { PushRunnerService } from './push-runner.service';

/**
 * Push notifications composed in the admin panel (promos, announcements,
 * repeating automations) for the customer app. Separate from
 * PushNotificationsModule, which sends the automatic order-status updates and
 * is not touched by anything here.
 */
@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([
            PushMessage,
            PushAudience,
            PushTemplate,
            PushSettings,
        ]),
    ],
    controllers: [PushMessagesController],
    providers: [
        PushMessagesService,
        PushSettingsService,
        PushAudienceService,
        PushDeviceSyncService,
        PushSenderService,
        PushRunnerService,
    ],
})
export class PushMessagesModule {}
