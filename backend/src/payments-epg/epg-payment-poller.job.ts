import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EpgService } from './epg.service';

/**
 * Safety-net poller: reconciles pending EPG sessions against the bank so a
 * dropped return-redirect (customer's internet died mid-payment) still gets
 * confirmed. The status endpoint also polls on demand when the customer
 * returns, so this is the backstop, not the primary path.
 *
 * The bank imposes no rate limit (5s cadence is fine); we sweep every 15s. An
 * overlap guard prevents a slow sweep from stacking. With the console provider
 * this will auto-confirm dev sessions (mock returns status 2).
 */
@Injectable()
export class EpgPaymentPollerJob {
    private readonly logger = new Logger(EpgPaymentPollerJob.name);
    private running = false;

    constructor(private readonly epgService: EpgService) {}

    @Interval('epg-payment-poll', 15_000)
    async poll(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            const { processed } = await this.epgService.sweepPending();
            if (processed > 0) {
                this.logger.log(`Polled ${processed} pending EPG session(s)`);
            }
        } catch (e) {
            this.logger.error(
                `EPG poll sweep failed: ${
                    e instanceof Error ? e.message : String(e)
                }`,
            );
        } finally {
            this.running = false;
        }
    }
}
