import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReviewsService } from './reviews.service';
import { TrainingService } from './training.service';
import { AttendanceService } from './attendance.service';
import { HrAlertsService } from './hr-alerts.service';

/**
 * The HR module's unattended work.
 *
 * All of these are things nobody will remember to do by hand, and each has
 * a cost for being forgotten: a review nobody scheduled never happens, a lapsed
 * food-handler certificate still counts toward a promotion, and punch photos
 * accumulate indefinitely against a retention policy that says 90 days.
 *
 * Every job is idempotent, so a missed night is made up for on the next run and a
 * double run changes nothing.
 */
@Injectable()
export class HrSchedulerService {
    private readonly logger = new Logger(HrSchedulerService.name);

    constructor(
        private readonly reviews: ReviewsService,
        private readonly training: TrainingService,
        private readonly attendance: AttendanceService,
        private readonly alerts: HrAlertsService,
    ) {}

    /**
     * 02:00 daily. Creates scheduled review cycles that have come due, expires
     * lapsed certificates, and purges punch photos past their retention window.
     *
     * Deliberately one job: the three are cheap, and a single log line a night is
     * easier to notice failing than three.
     */
    @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'hr-nightly' })
    async nightly(): Promise<void> {
        try {
            const cycles = await this.reviews.syncScheduledCycles();
            const expired = await this.training.expireLapsedTrainings();
            const photos = await this.attendance.purgeExpiredPhotos();
            // Runs last: it reads the review cycles and training expiries the
            // steps above just wrote, so a certificate that lapsed tonight is
            // alerted tonight rather than tomorrow.
            const alerts = await this.alerts.sweep();
            this.logger.log(
                `HR nightly: ${cycles.created} review cycle(s) created across ` +
                    `${cycles.employees} employee(s), ${expired} training(s) expired, ` +
                    `${photos} punch photo(s) purged, ${alerts.opened} alert(s) opened ` +
                    `and ${alerts.resolved} resolved`,
            );
        } catch (err) {
            // Never let a scheduled job take the process down.
            this.logger.error(
                'HR nightly job failed',
                err instanceof Error ? err.stack : String(err),
            );
        }
    }
}
