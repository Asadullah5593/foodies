import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersService } from './orders.service';

/**
 * Drives tier-based delivery dispatch that can't happen inline:
 * - Saver orders held until their per-brand hold window elapses, then dispatched.
 * - Priority/standard orders that found no rider get retried each tick.
 * The heavy lifting lives in OrdersService.sweepDeliveryDispatch(); this is just the trigger.
 */
@Injectable()
export class DeliveryDispatchJob {
    private readonly logger = new Logger(DeliveryDispatchJob.name);
    private running = false;

    constructor(private readonly ordersService: OrdersService) {}

    @Cron(CronExpression.EVERY_MINUTE)
    async handleTick(): Promise<void> {
        // Skip if a previous (slow) sweep is still running to avoid overlapping work.
        if (this.running) return;
        this.running = true;
        try {
            const { attempted, assigned } =
                await this.ordersService.sweepDeliveryDispatch();
            if (attempted > 0) {
                this.logger.log(
                    `Delivery dispatch sweep: attempted=${attempted} assigned=${assigned}`,
                );
            }
        } catch (e) {
            this.logger.error(
                'Delivery dispatch sweep failed',
                e instanceof Error ? e.stack : undefined,
            );
        } finally {
            this.running = false;
        }
    }
}
