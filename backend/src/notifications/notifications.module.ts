import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { getJwtSecret } from '../auth/jwt-secret.util';
import { Notification } from '../entities/notification.entity';
import { NotificationRecipient } from '../entities/notification-recipient.entity';
import { NotificationSetting } from '../entities/notification-setting.entity';
import { Role } from '../entities/role.entity';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsController } from './notifications.controller';
import { NotificationSettingsController } from './notification-settings.controller';

/**
 * Leaf module for the generic notifications pipeline. Imported by producers
 * (OrdersModule, InventoryModule) — it imports no heavy modules itself, so there
 * are no circular dependencies. AuthModule provides JwtAuthGuard/RoleAccessGuard;
 * JwtModule (own registration) provides JwtService for socket-handshake auth.
 */
@Module({
    imports: [
        AuthModule,
        JwtModule.registerAsync({
            useFactory: () => ({ secret: getJwtSecret() }),
        }),
        TypeOrmModule.forFeature([
            Notification,
            NotificationRecipient,
            NotificationSetting,
            Role,
        ]),
    ],
    controllers: [NotificationsController, NotificationSettingsController],
    providers: [
        NotificationsService,
        NotificationSettingsService,
        NotificationsGateway,
    ],
    exports: [NotificationsService],
})
export class NotificationsModule {}
