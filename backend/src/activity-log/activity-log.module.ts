import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLog } from '../entities/activity-log.entity';
import { ActivityLogWriter } from './activity-log.writer';
import { ActivityLogMaintenanceService } from './activity-log-maintenance.service';
import { ActivityLogMiddleware } from './activity-log.middleware';
import { ActivityLogInterceptor } from './activity-log.interceptor';

/**
 * Activity / audit log — Phases 0 and 1.
 *
 * Capture is wired but **dark**: with `ACTIVITY_LOG_ENABLED` unset or false the
 * middleware returns after minting a correlation id, the interceptor returns
 * `next.handle()` untouched, and nothing is written. The read API (Phase 2) and
 * archiving (Phase 6) are still to come.
 *
 * The middleware is registered in `main.ts` with `app.use()` rather than
 * `configure(consumer)` here, because it has to sit outside the global `/api`
 * prefix and ahead of everything — including the guards whose rejections are the
 * rows we most want.
 */
@Module({
    imports: [TypeOrmModule.forFeature([ActivityLog])],
    providers: [
        ActivityLogWriter,
        ActivityLogMaintenanceService,
        ActivityLogMiddleware,
        // The repo's first APP_* provider. Enrichment only — see the interceptor.
        { provide: APP_INTERCEPTOR, useClass: ActivityLogInterceptor },
    ],
    exports: [ActivityLogWriter, ActivityLogMiddleware],
})
export class ActivityLogModule {}
