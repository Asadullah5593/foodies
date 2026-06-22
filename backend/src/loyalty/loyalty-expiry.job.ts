import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LoyaltyWallet } from '../entities/loyalty-wallet.entity';

const SCAN_BATCH_SIZE = 2000;

/**
 * Daily job that enforces loyalty point expiry. For every `earn` lot whose
 * expiry_date has passed, it expires only the UNCONSUMED remainder (FIFO redeem
 * already drained the rest), writes an `expire` ledger row, and deducts the
 * wallet balance. Idempotent: expired lots are flagged so they are never
 * processed twice.
 */
@Injectable()
export class LoyaltyExpiryJob {
    private readonly logger = new Logger(LoyaltyExpiryJob.name);

    constructor(
        @InjectRepository(LoyaltyTransaction)
        private readonly txRepo: Repository<LoyaltyTransaction>,
        @InjectRepository(LoyaltyWallet)
        private readonly walletRepo: Repository<LoyaltyWallet>,
        private readonly dataSource: DataSource,
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async handleDailyExpiry() {
        await this.runExpiry();
    }

    private isDryRunEnabled() {
        return (
            String(process.env.LOYALTY_EXPIRY_DRY_RUN || '')
                .trim()
                .toLowerCase() === 'true'
        );
    }

    async runExpiry(): Promise<{ lotsExpired: number; pointsExpired: number }> {
        const dryRun = this.isDryRunEnabled();
        let lotsExpired = 0;
        let pointsExpired = 0;

        // Process in batches until no more expirable lots remain.

        while (true) {
            const lots = await this.txRepo
                .createQueryBuilder('lt')
                .where("lt.type = 'earn'")
                .andWhere('lt.expired = false')
                .andWhere('lt.pointsRemaining > 0')
                .andWhere('lt.expiryDate IS NOT NULL')
                .andWhere('lt.expiryDate <= now()')
                .orderBy('lt.walletId', 'ASC')
                .addOrderBy('lt.createdAt', 'ASC')
                .limit(SCAN_BATCH_SIZE)
                .getMany();
            if (!lots.length) break;

            // Group lots by wallet so we deduct each wallet once per transaction.
            const byWallet = new Map<number, LoyaltyTransaction[]>();
            for (const lot of lots) {
                if (lot.walletId == null) continue;
                const list = byWallet.get(lot.walletId) ?? [];
                list.push(lot);
                byWallet.set(lot.walletId, list);
            }

            if (dryRun) {
                for (const list of byWallet.values()) {
                    lotsExpired += list.length;
                    pointsExpired += list.reduce(
                        (sum, l) => sum + (l.pointsRemaining ?? 0),
                        0,
                    );
                }
                break; // avoid infinite loop in dry-run (nothing is flagged expired)
            }

            for (const [walletId, walletLots] of byWallet) {
                await this.dataSource.transaction(async (manager) => {
                    const wallet = await manager.findOne(LoyaltyWallet, {
                        where: { id: walletId },
                        lock: { mode: 'pessimistic_write' },
                    });
                    if (!wallet) return;
                    let total = 0;
                    for (const lot of walletLots) {
                        // Re-read the lot under lock; it may have been consumed since the scan.
                        const fresh = await manager.findOne(
                            LoyaltyTransaction,
                            {
                                where: { id: lot.id },
                                lock: { mode: 'pessimistic_write' },
                            },
                        );
                        const remaining = fresh?.pointsRemaining ?? 0;
                        if (!fresh || fresh.expired || remaining <= 0) continue;
                        await manager.save(
                            manager.create(LoyaltyTransaction, {
                                customerId: wallet.customerId,
                                orderId: fresh.orderId,
                                walletId: wallet.id,
                                walletType: wallet.walletType,
                                brandId: wallet.brandId,
                                points: -remaining,
                                type: 'expire',
                            }),
                        );
                        await manager.update(LoyaltyTransaction, fresh.id, {
                            pointsRemaining: 0,
                            expired: true,
                            expiredAt: new Date(),
                        });
                        total += remaining;
                        lotsExpired += 1;
                        pointsExpired += remaining;
                    }
                    if (total > 0) {
                        await manager.update(LoyaltyWallet, wallet.id, {
                            balance: Math.max(0, wallet.balance - total),
                        });
                    }
                });
            }
        }

        this.logger.log(
            `Loyalty expiry run complete (dryRun=${dryRun}) lotsExpired=${lotsExpired} pointsExpired=${pointsExpired}`,
        );
        return { lotsExpired, pointsExpired };
    }
}
