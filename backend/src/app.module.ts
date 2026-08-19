import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { BrandsModule } from './brands/brands.module';
import { BranchesModule } from './branches/branches.module';
import { UsersModule } from './users/users.module';
import { MenuModule } from './menu/menu.module';
import { CategoriesModule } from './categories/categories.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { DiscountsModule } from './discounts/discounts.module';
import { InvoicesModule } from './invoices/invoices.module';
import { BankCardsModule } from './bank-cards/bank-cards.module';
import { StaffDiscountsModule } from './staff-discounts/staff-discounts.module';
import { ShiftsModule } from './shifts/shifts.module';
import { ReportsModule } from './reports/reports.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { BranchUsersModule } from './branch-users/branch-users.module';
import { BranchMenuItemsModule } from './branch-menu-items/branch-menu-items.module';
import { RolesModule } from './roles/roles.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { CustomersModule } from './customers/customers.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { ConsumerModule } from './consumer/consumer.module';
import { UploadModule } from './upload/upload.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProcurementModule } from './procurement/procurement.module';
import { RecipesModule } from './recipes/recipes.module';
import { RiderHrmModule } from './rider-hrm/rider-hrm.module';
import { FirebaseModule } from './firebase/firebase.module';
import { KioskModule } from './kiosk/kiosk.module';
import { BannersModule } from './banners/banners.module';
import { PromotionsModule } from './promotions/promotions.module';
import { CouponsModule } from './coupons/coupons.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { NotificationsModule } from './notifications/notifications.module';
import { FbrModule } from './fbr/fbr.module';
import { PaymentsEpgModule } from './payments-epg/payments-epg.module';
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: [
                join(__dirname, '..', '.env'),
                join(__dirname, '..', '..', '.env'),
            ],
        }),
        TypeOrmModule.forRoot({
            type: 'postgres',
            host: process.env.DB_HOST || '127.0.0.1',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            username: process.env.DB_USERNAME || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_DATABASE || 'foodies',
            ...(process.env.DB_SSL === 'true'
                ? { ssl: { rejectUnauthorized: false } }
                : {}),
            // node-postgres pool size. Raised to absorb concurrent order bursts —
            // the previous default (~10) was the bottleneck under load. Override
            // with DB_POOL_MAX. NOTE: Postgres `max_connections` must exceed this
            // (plus room for migrations/psql/other clients), or connections are
            // refused; default PG max_connections is 100, so raise it in prod.
            extra: { max: parseInt(process.env.DB_POOL_MAX || '100', 10) },
            namingStrategy: new SnakeNamingStrategy(),
            synchronize: false,
            migrationsRun: true,
            migrations: [join(__dirname, 'migrations', '*.js')],
            entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
        }),
        ScheduleModule.forRoot(),
        FirebaseModule,
        AuthModule,
        TenantsModule,
        BrandsModule,
        BranchesModule,
        UsersModule,
        MenuModule,
        CategoriesModule,
        OrdersModule,
        PaymentsModule,
        DiscountsModule,
        InvoicesModule,
        BankCardsModule,
        StaffDiscountsModule,
        ShiftsModule,
        ReportsModule,
        ActivityLogModule,
        BranchUsersModule,
        BranchMenuItemsModule,
        RolesModule,
        KitchenModule,
        CustomersModule,
        LoyaltyModule,
        ConsumerModule,
        UploadModule,
        InventoryModule,
        ProcurementModule,
        RecipesModule,
        RiderHrmModule,
        KioskModule,
        BannersModule,
        PromotionsModule,
        CouponsModule,
        CampaignsModule,
        NotificationsModule,
        FbrModule,
        PaymentsEpgModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
