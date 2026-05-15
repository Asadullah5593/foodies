import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { RiderOpsMetricsService } from './rider-ops-metrics.service';

@ApiTags('Admin – Rider Ops')
@ApiBearerAuth()
@Controller('admin/rider-ops')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class AdminRiderOpsController {
    constructor(private readonly metrics: RiderOpsMetricsService) {}

    @Get('metrics')
    metricsSnapshot() {
        return this.metrics.snapshot();
    }
}
