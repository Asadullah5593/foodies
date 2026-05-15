import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { Order } from '../entities/order.entity';
import { RiderOrderLocation } from '../entities/rider-order-location.entity';
import { RiderOrderLocationSummary } from '../entities/rider-order-location-summary.entity';

const TERMINAL_DELIVERY_STATUSES = ['delivered', 'delivery_failed'];
const HOT_RETENTION_DAYS = 5;
const WARM_RETENTION_DAYS = 10;
const DAILY_MAX_DELETE_ROWS = 100000;
const DELETE_BATCH_SIZE = 5000;
const DELETE_BATCH_SLEEP_MS = 100;
const SUMMARY_SAMPLE_SIZE = 25;

@Injectable()
export class RiderLocationRetentionService {
    private readonly logger = new Logger(RiderLocationRetentionService.name);

    constructor(
        @InjectRepository(Order)
        private readonly orderRepo: Repository<Order>,
        @InjectRepository(RiderOrderLocation)
        private readonly locationRepo: Repository<RiderOrderLocation>,
        @InjectRepository(RiderOrderLocationSummary)
        private readonly summaryRepo: Repository<RiderOrderLocationSummary>,
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async handleDailyRetentionCleanup() {
        await this.runRetentionCleanup();
    }

    async runRetentionCleanup() {
        const dryRun = this.isDryRunEnabled();
        const now = Date.now();
        const hotCutoff = new Date(
            now - HOT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );
        const warmCutoff = new Date(
            now - WARM_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        );

        const summariesCreated = await this.ensureWarmSummaries(
            hotCutoff,
            dryRun,
        );
        const deletedRaw = await this.deleteRawLocationBatches(
            warmCutoff,
            dryRun,
        );
        const deletedWarmSummaries = await this.deleteExpiredSummaries(
            warmCutoff,
            dryRun,
        );

        this.logger.log(
            `Rider location retention run complete (dryRun=${dryRun}) summariesCreated=${summariesCreated} deletedRaw=${deletedRaw} deletedWarmSummaries=${deletedWarmSummaries}`,
        );
    }

    private isDryRunEnabled() {
        return (
            String(process.env.RIDER_LOCATION_RETENTION_DRY_RUN || '')
                .trim()
                .toLowerCase() === 'true'
        );
    }

    private async ensureWarmSummaries(hotCutoff: Date, dryRun: boolean) {
        const terminalOrders = await this.orderRepo
            .createQueryBuilder('o')
            .select('o.id', 'orderId')
            .innerJoin(RiderOrderLocation, 'l', 'l.order_id = o.id')
            .leftJoin(RiderOrderLocationSummary, 's', 's.order_id = o.id')
            .where('o.delivery_status IN (:...statuses)', {
                statuses: TERMINAL_DELIVERY_STATUSES,
            })
            .andWhere('l.created_at < :hotCutoff', { hotCutoff })
            .andWhere('s.id IS NULL')
            .groupBy('o.id')
            .orderBy('MIN(l.created_at)', 'ASC')
            .limit(1000)
            .getRawMany<{ orderId: string }>();

        let created = 0;
        for (const row of terminalOrders) {
            const orderId = Number(row.orderId);
            if (!Number.isFinite(orderId)) continue;
            const points = await this.locationRepo.find({
                where: { orderId },
                order: { createdAt: 'ASC' },
            });
            if (!points.length) continue;

            const summary = this.summaryRepo.create({
                orderId,
                pointsCount: points.length,
                startLatitude: Number(points[0].latitude),
                startLongitude: Number(points[0].longitude),
                endLatitude: Number(points[points.length - 1].latitude),
                endLongitude: Number(points[points.length - 1].longitude),
                startRecordedAt: points[0].createdAt,
                endRecordedAt: points[points.length - 1].createdAt,
                sampledPath: this.samplePoints(points).map((point) => ({
                    latitude: Number(point.latitude),
                    longitude: Number(point.longitude),
                    recorded_at: point.createdAt.toISOString(),
                })),
            });
            if (!dryRun) {
                await this.summaryRepo.save(summary);
            }
            created += 1;
        }

        if (terminalOrders.length > 0) {
            this.logger.log(
                `Warm summary build complete (dryRun=${dryRun}) candidates=${terminalOrders.length} created=${created}`,
            );
        }

        return created;
    }

    private samplePoints(points: RiderOrderLocation[]) {
        if (points.length <= SUMMARY_SAMPLE_SIZE) return points;
        const stride = Math.ceil(points.length / SUMMARY_SAMPLE_SIZE);
        const sampled = points.filter((_, idx) => idx % stride === 0);
        const lastPoint = points[points.length - 1];
        const sampledLast = sampled[sampled.length - 1];
        if (sampledLast.id !== lastPoint.id) sampled.push(lastPoint);
        return sampled.slice(0, SUMMARY_SAMPLE_SIZE);
    }

    private async deleteRawLocationBatches(warmCutoff: Date, dryRun: boolean) {
        let totalDeleted = 0;
        while (totalDeleted < DAILY_MAX_DELETE_ROWS) {
            const remaining = DAILY_MAX_DELETE_ROWS - totalDeleted;
            const batchLimit = Math.min(DELETE_BATCH_SIZE, remaining);

            const candidateRows = await this.locationRepo
                .createQueryBuilder('l')
                .select('l.id', 'id')
                .innerJoin(Order, 'o', 'o.id = l.order_id')
                .innerJoin(
                    RiderOrderLocationSummary,
                    's',
                    's.order_id = l.order_id',
                )
                .where('o.delivery_status IN (:...statuses)', {
                    statuses: TERMINAL_DELIVERY_STATUSES,
                })
                .andWhere('l.created_at < :warmCutoff', { warmCutoff })
                .orderBy('l.created_at', 'ASC')
                .limit(batchLimit)
                .getRawMany<{ id: string }>();

            const ids = candidateRows
                .map((r) => Number(r.id))
                .filter((id) => Number.isFinite(id));
            if (!ids.length) break;

            if (!dryRun) {
                await this.locationRepo
                    .createQueryBuilder()
                    .delete()
                    .from(RiderOrderLocation)
                    .where('id IN (:...ids)', { ids })
                    .execute();
            }
            totalDeleted += ids.length;

            if (ids.length < batchLimit) break;
            await new Promise((resolve) =>
                setTimeout(resolve, DELETE_BATCH_SLEEP_MS),
            );
        }

        this.logger.log(
            `Raw location cleanup complete (dryRun=${dryRun}) deleted=${totalDeleted}`,
        );
        return totalDeleted;
    }

    private async deleteExpiredSummaries(warmCutoff: Date, dryRun: boolean) {
        const expired = await this.summaryRepo.find({
            where: {
                endRecordedAt: LessThan(warmCutoff),
                order: { deliveryStatus: In(TERMINAL_DELIVERY_STATUSES) },
            },
            relations: { order: true },
            take: DAILY_MAX_DELETE_ROWS,
            order: { endRecordedAt: 'ASC' },
        });
        if (!expired.length) return 0;

        const orderIds = expired.map((row) => row.orderId);
        const ordersStillWithRaw = await this.locationRepo
            .createQueryBuilder('l')
            .select('l.order_id', 'orderId')
            .where('l.order_id IN (:...orderIds)', { orderIds })
            .groupBy('l.order_id')
            .getRawMany<{ orderId: string }>();

        const protectedOrderIds = new Set(
            ordersStillWithRaw.map((r) => Number(r.orderId)),
        );
        const deletableSummaryIds = expired
            .filter((row) => !protectedOrderIds.has(row.orderId))
            .map((row) => row.id);
        if (!deletableSummaryIds.length) return 0;

        if (!dryRun) {
            await this.summaryRepo
                .createQueryBuilder()
                .delete()
                .from(RiderOrderLocationSummary)
                .where('id IN (:...ids)', { ids: deletableSummaryIds })
                .execute();
        }

        this.logger.log(
            `Warm summary cleanup complete (dryRun=${dryRun}) deleted=${deletableSummaryIds.length} protected=${protectedOrderIds.size}`,
        );
        return deletableSummaryIds.length;
    }
}
