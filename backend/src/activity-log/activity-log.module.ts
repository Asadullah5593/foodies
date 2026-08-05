import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLog } from '../entities/activity-log.entity';
import { ActivityLogWriter } from './activity-log.writer';
import { ActivityLogMaintenanceService } from './activity-log-maintenance.service';

/**
 * Activity / audit log — Phase 0.
 *
 * Nothing here observes traffic yet: the middleware and the APP_INTERCEPTOR
 * arrive in Phase 1, and the read API in Phase 2. What this module does today
 * is own the writer (so Phase 1 has somewhere to hand rows) and keep the
 * table's partitions ahead of the clock.
 *
 * Registering it is deliberately inert: the writer has no callers, and the
 * maintenance job only creates future partitions unless
 * ACTIVITY_LOG_RETENTION_ENABLED is explicitly turned on.
 */
@Module({
    imports: [TypeOrmModule.forFeature([ActivityLog])],
    providers: [ActivityLogWriter, ActivityLogMaintenanceService],
    exports: [ActivityLogWriter],
})
export class ActivityLogModule {}
