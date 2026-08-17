import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { ReviewsService } from './reviews.service';
import { TrainingService } from './training.service';
import type { HrUser } from './employee-scope';
import {
    CreateAdHocReviewDto,
    SaveReviewDraftDto,
    SkipCycleDto,
    SubmitReviewDto,
} from './dto/review.dto';
import {
    AssignTrainingDto,
    CreateProgramDto,
    RecordTrainingDto,
    SetRequirementDto,
} from './dto/training.dto';

@ApiTags('Admin – Reviews')
@ApiBearerAuth()
@Controller('admin/hr/reviews')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class ReviewsController {
    constructor(private readonly reviews: ReviewsService) {}

    @Get('cycles')
    @RequirePermission(Permissions.REVIEWS_VIEW)
    @ApiOperation({
        summary: 'Review cycles',
        description:
            'Each row says whether it is a SCHEDULED cycle or an ad-hoc one. Completion metrics should count scheduled cycles only — otherwise opening ad-hoc reviews inflates them.',
    })
    listCycles(
        @CurrentUser() user: HrUser,
        @Query('status') status?: string,
        @Query('employee_id') employeeId?: string,
        @Query('overdue_only') overdueOnly?: string,
    ) {
        return this.reviews.listCycles(user, {
            status,
            employee_id: employeeId ? Number(employeeId) : undefined,
            overdue_only: overdueOnly === '1' || overdueOnly === 'true',
        });
    }

    @Get('templates')
    @RequirePermission(Permissions.REVIEWS_VIEW)
    listTemplates(@CurrentUser() user: HrUser) {
        return this.reviews.listTemplates(user);
    }

    @Post('sync')
    @RequirePermission(Permissions.REVIEWS_APPROVE)
    @ApiOperation({
        summary: 'Generate scheduled cycles that have come due',
        description:
            'Runs nightly too. Reads only cycles with origin=system, so an ad-hoc review can never shift the cadence. Idempotent.',
    })
    sync(@CurrentUser() user: HrUser) {
        return this.reviews.syncScheduledCycles(user.tenantId ?? undefined);
    }

    @Post('ad-hoc')
    @RequirePermission(Permissions.REVIEWS_INITIATE_ADHOC)
    @ApiOperation({
        summary: 'Raise an out-of-cycle review',
        description:
            'Recorded with origin=manual and therefore invisible to the scheduler: it cannot delay, replace or satisfy a scheduled review. Its outcome carries the same weight.',
    })
    createAdHoc(
        @CurrentUser() user: HrUser,
        @Body() dto: CreateAdHocReviewDto,
    ) {
        return this.reviews.createAdHoc(user, dto);
    }

    @Get('cycles/:id')
    @RequirePermission(Permissions.REVIEWS_CONDUCT)
    @ApiOperation({
        summary: 'Open the form',
        description:
            'Creates the draft on first open and snapshots the template into it, so an old review always renders against the questions it was actually answered with. Returns the employee history and training status beside the form.',
    })
    open(@CurrentUser() user: HrUser, @Param('id', ParseIntPipe) id: number) {
        return this.reviews.openReview(user, id);
    }

    @Patch('cycles/:id')
    @RequirePermission(Permissions.REVIEWS_CONDUCT)
    @ApiOperation({ summary: 'Save a draft and rescore' })
    saveDraft(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: SaveReviewDraftDto,
    ) {
        return this.reviews.saveDraft(user, id, dto);
    }

    @Post('cycles/:id/submit')
    @RequirePermission(Permissions.REVIEWS_CONDUCT)
    @ApiOperation({
        summary: 'Submit with a decision',
        description:
            'Training gaps for a promotion target are snapshotted and WARN only — the client chose not to block.',
    })
    submit(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: SubmitReviewDto,
    ) {
        return this.reviews.submitReview(user, id, dto);
    }

    @Post('cycles/:id/approve')
    @RequirePermission(Permissions.REVIEWS_APPROVE)
    @ApiOperation({
        summary: 'Approve and apply the outcome',
        description:
            'One transaction writes the new assignment, the new salary structure and the timeline entries, so a promotion is a state change with a paper trail rather than a note.',
    })
    approve(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.reviews.approveReview(user, id);
    }

    @Post('cycles/:id/skip')
    @RequirePermission(Permissions.REVIEWS_APPROVE)
    @ApiOperation({
        summary: 'Skip a cycle with a reason',
        description:
            'Does not change when the next scheduled review falls due.',
    })
    skip(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: SkipCycleDto,
    ) {
        return this.reviews.skipCycle(user, id, dto.reason);
    }
}

@ApiTags('Admin – Training')
@ApiBearerAuth()
@Controller('admin/hr/training')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class TrainingController {
    constructor(private readonly training: TrainingService) {}

    @Get('programs')
    @RequirePermission(Permissions.TRAINING_VIEW)
    listPrograms(
        @CurrentUser() user: HrUser,
        @Query('include_inactive') inc?: string,
    ) {
        return this.training.listPrograms(user, inc === '1' || inc === 'true');
    }

    @Post('programs')
    @RequirePermission(Permissions.TRAINING_MANAGE)
    createProgram(@CurrentUser() user: HrUser, @Body() dto: CreateProgramDto) {
        return this.training.createProgram(user, dto);
    }

    @Get('employees/:id')
    @RequirePermission(Permissions.TRAINING_VIEW)
    @ApiOperation({
        summary: 'One employee’s training record',
        description:
            'Includes expiring_soon, since a certificate about to lapse is the thing worth chasing before it does.',
    })
    employeeTrainings(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.training.employeeTrainings(user, id);
    }

    @Post('employees/:id/assign')
    @RequirePermission(Permissions.TRAINING_RECORD)
    assign(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: AssignTrainingDto,
    ) {
        return this.training.assign(user, id, dto.program_id);
    }

    @Patch('records/:id')
    @RequirePermission(Permissions.TRAINING_RECORD)
    @ApiOperation({
        summary: 'Record progress or completion',
        description:
            'Expiry is computed from the program’s validity at completion and stored, so shortening a validity later cannot retroactively expire certificates people already hold.',
    })
    record(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RecordTrainingDto,
    ) {
        return this.training.recordOutcome(user, id, dto);
    }

    @Get('requirements')
    @RequirePermission(Permissions.TRAINING_VIEW)
    listRequirements(
        @CurrentUser() user: HrUser,
        @Query('designation_id') designationId?: string,
    ) {
        return this.training.listRequirements(
            user,
            designationId ? Number(designationId) : undefined,
        );
    }

    @Post('requirements')
    @RequirePermission(Permissions.TRAINING_MANAGE)
    @ApiOperation({
        summary: 'Require a program for a designation',
        description:
            'Drives the readiness panel on the review form. Advisory: a gap warns, it never blocks a promotion.',
    })
    setRequirement(
        @CurrentUser() user: HrUser,
        @Body() dto: SetRequirementDto,
    ) {
        return this.training.setRequirement(user, dto);
    }

    @Delete('requirements/:id')
    @RequirePermission(Permissions.TRAINING_MANAGE)
    removeRequirement(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.training.removeRequirement(user, id);
    }

    @Get('expiring')
    @RequirePermission(Permissions.TRAINING_VIEW)
    @ApiOperation({ summary: 'Certificates lapsing soon' })
    expiring(
        @CurrentUser() user: HrUser,
        @Query('within_days') withinDays?: string,
    ) {
        return this.training.expiringSoon(
            user,
            withinDays ? Number(withinDays) : 30,
        );
    }

    @Get('readiness/:employeeId/:designationId')
    @RequirePermission(Permissions.TRAINING_VIEW)
    @ApiOperation({ summary: 'Is this employee training-ready for that role?' })
    readiness(
        @CurrentUser() user: HrUser,
        @Param('employeeId', ParseIntPipe) employeeId: number,
        @Param('designationId', ParseIntPipe) designationId: number,
    ) {
        return this.training.readinessFor(user, employeeId, designationId);
    }
}
