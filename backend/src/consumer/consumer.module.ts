import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Branch } from '../entities/branch.entity';
import { BrandsModule } from '../brands/brands.module';
import { BranchesModule } from '../branches/branches.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { CustomersModule } from '../customers/customers.module';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';
import { OtpModule } from '../otp/otp.module';
import { CartModule } from '../cart/cart.module';
import { MailModule } from '../mail/mail.module';
import { MediaModule } from '../media/media.module';
import { ConsumerController } from './consumer.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([Branch]),
        JwtModule.register({
            secret:
                process.env.JWT_SECRET ||
                'rough-foodie-secret-change-in-production',
            signOptions: { expiresIn: '7d' },
        }),
        BrandsModule,
        BranchesModule,
        MenuModule,
        OrdersModule,
        LoyaltyModule,
        CustomersModule,
        PaymentsModule,
        AuthModule,
        OtpModule,
        CartModule,
        MailModule,
        MediaModule,
    ],
    controllers: [ConsumerController],
})
export class ConsumerModule {}
