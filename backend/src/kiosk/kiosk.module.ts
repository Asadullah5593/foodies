import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { BranchesModule } from '../branches/branches.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { KioskOrder } from '../entities/kiosk-order.entity';
import { Branch } from '../entities/branch.entity';
import { MenuVariant } from '../entities/menu-variant.entity';
import { KioskService } from './kiosk.service';
import { KioskApiKeyGuard } from './kiosk-api-key.guard';
import { PublicKioskController } from './public-kiosk.controller';
import { PosKioskController } from './pos-kiosk.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([KioskOrder, Branch, MenuVariant]),
        AuthModule,
        OrdersModule,
        PaymentsModule,
        BranchesModule,
        ShiftsModule,
    ],
    controllers: [PublicKioskController, PosKioskController],
    providers: [KioskService, KioskApiKeyGuard],
    exports: [KioskService],
})
export class KioskModule {}
