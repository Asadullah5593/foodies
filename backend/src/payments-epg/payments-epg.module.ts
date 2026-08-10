import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { Branch } from '../entities/branch.entity';
import { ConsoleEpgProvider } from './console-epg.provider';
import { MeezanEpgProvider } from './meezan-epg.provider';
import { EpgPaymentSession } from './epg-payment-session.entity';
import { EpgService } from './epg.service';
import { EpgPaymentPollerJob } from './epg-payment-poller.job';
import { PaymentsEpgController } from './payments-epg.controller';
import { PAYMENT_GATEWAY } from './epg.types';

/**
 * Online-card payments via Meezan EPG (one-phase, create-on-confirm).
 *
 * PAYMENT_GATEWAY selects the driver (meezan | console) off PAYMENT_PROVIDER.
 * EpgService orchestrates sessions; the poller reconciles pending ones; the
 * controller exposes the app-facing session endpoints. Imports OrdersModule +
 * PaymentsModule to reuse createOrder + processPayment on confirmation (no
 * cycle — neither imports this module).
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([EpgPaymentSession, Branch]),
        AuthModule,
        OrdersModule,
        PaymentsModule,
    ],
    controllers: [PaymentsEpgController],
    providers: [
        {
            provide: PAYMENT_GATEWAY,
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const logger = new Logger('PaymentsEpgModule');
                const provider = (
                    config.get<string>('PAYMENT_PROVIDER') || 'console'
                )
                    .trim()
                    .toLowerCase();

                if (provider === 'meezan') {
                    // Fails closed (constructor throws) if creds are missing —
                    // a bad live config aborts boot, like the JWT_SECRET check.
                    const p = new MeezanEpgProvider({
                        baseUrl: (
                            config.get<string>('MEEZAN_EPG_BASE_URL') || ''
                        ).trim(),
                        userName: (
                            config.get<string>('MEEZAN_EPG_USERNAME') || ''
                        ).trim(),
                        password: (
                            config.get<string>('MEEZAN_EPG_PASSWORD') || ''
                        ).trim(),
                        currency: (
                            config.get<string>('MEEZAN_EPG_CURRENCY') || '586'
                        ).trim(),
                        timeoutMs:
                            Number(
                                config.get<string>('MEEZAN_EPG_TIMEOUT_MS'),
                            ) || 20_000,
                        defaultLanguage: (
                            config.get<string>('MEEZAN_EPG_LANGUAGE') || 'en'
                        ).trim(),
                    });
                    logger.log('Payment gateway: Meezan EPG (live)');
                    return p;
                }

                logger.warn(
                    'Payment gateway: console (dev mock, no real payments). Set PAYMENT_PROVIDER=meezan to enable Meezan EPG.',
                );
                return new ConsoleEpgProvider();
            },
        },
        EpgService,
        EpgPaymentPollerJob,
    ],
    exports: [PAYMENT_GATEWAY, EpgService],
})
export class PaymentsEpgModule {}
