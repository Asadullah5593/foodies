import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { ReviewCycle } from '../entities/review-cycle.entity';
import { ReviewTemplate } from '../entities/review-template.entity';
import { EmployeeReview } from '../entities/employee-review.entity';
import { Employee } from '../entities/employee.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { EmployeeSalaryStructure } from '../entities/employee-salary-structure.entity';
import { Designation } from '../entities/designation.entity';
import { Permissions } from '../roles/permissions.dto';
import { EmployeesService } from './employees.service';
import { TrainingService } from './training.service';
import { HrAuditService } from './hr-audit.service';
import { hasPermission, HrUser } from './employee-scope';
import {
    isOverdue,
    nextScheduledCycle,
    outcomeEffects,
    ReviewQuestion,
    scoreReview,
    shouldCreateCycle,
} from './review-rules';

/** Pull the flat question list out of a template's section structure. */
function questionsOf(schema: Record<string, unknown>): ReviewQuestion[] {
    const sections = Array.isArray(schema?.sections) ? schema.sections : [];
    return sections.flatMap((s) =>
        Array.isArray((s as { questions?: unknown }).questions)
            ? ((s as { questions: ReviewQuestion[] }).questions ?? [])
            : [],
    );
}

@Injectable()
export class ReviewsService {
    private readonly logger = new Logger(ReviewsService.name);

    constructor(
        @InjectRepository(ReviewCycle)
        private readonly cycles: Repository<ReviewCycle>,
        @InjectRepository(ReviewTemplate)
        private readonly templates: Repository<ReviewTemplate>,
        @InjectRepository(EmployeeReview)
        private readonly reviews: Repository<EmployeeReview>,
        @InjectRepository(Employee)
        private readonly employees: Repository<Employee>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
        @InjectRepository(EmployeeSalaryStructure)
        private readonly structures: Repository<EmployeeSalaryStructure>,
        @InjectRepository(Designation)
        private readonly designations: Repository<Designation>,
        private readonly employeesService: EmployeesService,
        private readonly training: TrainingService,
        private readonly audit: HrAuditService,
        private readonly dataSource: DataSource,
    ) {}

    // ------------------------------------------------------------- scheduler

    /**
     * Create the scheduled cycles that have come due.
     *
     * ⚠️ `lastScheduled` is read with `origin = 'system'`. That single filter is
     * what makes an ad-hoc review incapable of moving the cadence — the client's
     * requirement, and the reason ad-hoc reviews are safe to raise freely.
     *
     * Idempotent: the partial unique index allows one open scheduled cycle per
     * employee, so re-running creates nothing new.
     */
    async syncScheduledCycles(tenantId?: number): Promise<{
        created: number;
        employees: number;
    }> {
        const today = new Date().toISOString().slice(0, 10);
        const qb = this.employees
            .createQueryBuilder('e')
            .where('e.dateOfLeaving IS NULL')
            .andWhere("e.status NOT IN ('resigned', 'terminated')");
        if (tenantId != null) {
            qb.andWhere('e.tenantId = :tenantId', { tenantId });
        }
        const staff = await qb.getMany();

        let created = 0;
        for (const employee of staff) {
            // An employee with a scheduled cycle still open needs nothing.
            const open = await this.cycles.findOne({
                where: {
                    employeeId: employee.id,
                    origin: 'system',
                    status: In(['scheduled', 'in_progress', 'submitted']),
                },
            });
            if (open) continue;

            const lastScheduled = await this.cycles.findOne({
                where: { employeeId: employee.id, origin: 'system' },
                order: { sequenceNo: 'DESC', id: 'DESC' },
            });

            const next = nextScheduledCycle({
                dateOfJoining: employee.dateOfJoining,
                dateOfLeaving: employee.dateOfLeaving,
                lastScheduled: lastScheduled
                    ? {
                          sequenceNo: lastScheduled.sequenceNo ?? 1,
                          periodTo: lastScheduled.periodTo,
                      }
                    : null,
            });
            if (!next || !shouldCreateCycle(next, today)) continue;

            const template = await this.templateFor(
                employee.tenantId,
                next.cycleType,
            );
            await this.cycles.save(
                this.cycles.create({
                    tenantId: employee.tenantId,
                    employeeId: employee.id,
                    sequenceNo: next.sequenceNo,
                    cycleType: next.cycleType,
                    origin: 'system',
                    periodFrom: next.periodFrom,
                    periodTo: next.periodTo,
                    dueDate: next.dueDate,
                    templateId: template?.id ?? null,
                    status: 'scheduled',
                }),
            );
            created += 1;
        }

        if (created > 0) {
            this.logger.log(`Created ${created} scheduled review cycle(s)`);
        }
        return { created, employees: staff.length };
    }

    private templateFor(tenantId: number, cycleType: string) {
        return this.templates
            .createQueryBuilder('t')
            .where('t.tenantId = :tenantId', { tenantId })
            .andWhere('t.isActive = true')
            .andWhere(`t.applies_to_cycle_types @> :ct`, {
                ct: JSON.stringify([cycleType]),
            })
            .orderBy('t.id', 'ASC')
            .getOne();
    }

    // -------------------------------------------------------------- cycles

    async listCycles(
        user: HrUser,
        filters: {
            status?: string;
            employee_id?: number;
            overdue_only?: boolean;
        },
    ) {
        const qb = this.cycles
            .createQueryBuilder('c')
            .leftJoin('c.employee', 'emp')
            .leftJoin('c.reviewer', 'rev')
            .select([
                'c.id',
                'c.cycleType',
                'c.origin',
                'c.adHocReason',
                'c.sequenceNo',
                'c.periodFrom',
                'c.periodTo',
                'c.dueDate',
                'c.status',
                'c.templateId',
                'emp.id',
                'emp.fullName',
                'emp.employeeCode',
                'rev.id',
                'rev.name',
            ])
            .orderBy('c.dueDate', 'ASC');

        if (user.tenantId != null) {
            qb.andWhere('c.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (user.allowedBranchIds != null) {
            if (user.allowedBranchIds.length === 0) return [];
            qb.innerJoin(
                'employee_assignments',
                'cur',
                'cur.employee_id = emp.id AND cur.effective_to IS NULL',
            ).andWhere('cur.branch_id IN (:...branchIds)', {
                branchIds: user.allowedBranchIds,
            });
        }
        if (filters.status) {
            qb.andWhere('c.status = :status', { status: filters.status });
        }
        if (filters.employee_id) {
            qb.andWhere('c.employeeId = :employeeId', {
                employeeId: filters.employee_id,
            });
        }
        if (filters.overdue_only) {
            qb.andWhere('c.dueDate < CURRENT_DATE').andWhere(
                "c.status IN ('scheduled', 'in_progress')",
            );
        }

        const rows = await qb.getMany();
        const today = new Date().toISOString().slice(0, 10);
        return rows.map((c) => ({
            id: c.id,
            cycle_type: c.cycleType,
            /** Ad-hoc reviews are excluded from completion metrics. */
            is_scheduled: c.origin === 'system',
            ad_hoc_reason: c.adHocReason,
            sequence_no: c.sequenceNo,
            period_from: c.periodFrom,
            period_to: c.periodTo,
            due_date: c.dueDate,
            overdue:
                ['scheduled', 'in_progress'].includes(c.status) &&
                isOverdue(c.dueDate, today),
            status: c.status,
            template_id: c.templateId,
            employee: {
                id: c.employee?.id,
                full_name: c.employee?.fullName,
                employee_code: c.employee?.employeeCode,
            },
            reviewer: c.reviewer
                ? { id: c.reviewer.id, name: c.reviewer.name }
                : null,
        }));
    }

    /**
     * Raise an out-of-cycle review.
     *
     * Recorded with `origin = 'manual'`, which the scheduler never reads — so
     * this cannot delay, replace or satisfy the scheduled cadence. Several may be
     * open at once, and the outcome carries the same weight as a scheduled one.
     */
    async createAdHoc(
        user: HrUser,
        dto: {
            employee_id: number;
            ad_hoc_reason: string;
            due_date: string;
            period_from?: string;
            reviewer_user_id?: number;
        },
    ) {
        if (!hasPermission(user, Permissions.REVIEWS_INITIATE_ADHOC)) {
            throw new ForbiddenException(
                'Raising an out-of-cycle review requires reviews:initiate-adhoc',
            );
        }
        const employee = await this.employeesService.loadScoped(
            user,
            dto.employee_id,
        );
        if (['resigned', 'terminated'].includes(employee.status)) {
            throw new BadRequestException('This employee has left');
        }

        const template = await this.templateFor(employee.tenantId, 'ad_hoc');
        const saved = await this.cycles.save(
            this.cycles.create({
                tenantId: employee.tenantId,
                employeeId: employee.id,
                sequenceNo: null,
                cycleType: 'ad_hoc',
                origin: 'manual',
                adHocReason: dto.ad_hoc_reason,
                periodFrom: dto.period_from ?? dto.due_date,
                periodTo: dto.due_date,
                dueDate: dto.due_date,
                reviewerUserId: dto.reviewer_user_id ?? user.id,
                templateId: template?.id ?? null,
                status: 'scheduled',
                createdBy: user.id,
            }),
        );
        return { id: saved.id };
    }

    /** Skip a cycle with a reason. Does not affect when the next one falls. */
    async skipCycle(user: HrUser, cycleId: number, reason: string) {
        if (!reason?.trim()) {
            throw new BadRequestException('A reason is required to skip');
        }
        const cycle = await this.loadCycleScoped(user, cycleId);
        if (!['scheduled', 'in_progress'].includes(cycle.status)) {
            throw new BadRequestException(
                `A ${cycle.status} cycle cannot be skipped`,
            );
        }
        await this.cycles.update(
            { id: cycleId },
            { status: 'skipped', skipReason: reason.trim() },
        );
        await this.audit.record({
            tenantId: cycle.tenantId,
            actorUserId: user.id,
            action: 'review.cycle.skipped',
            entityTable: 'review_cycles',
            entityId: cycleId,
            after: { reason: reason.trim() },
        });
        return { id: cycleId, status: 'skipped' };
    }

    // -------------------------------------------------------------- reviews

    /**
     * Open the form, creating the draft on first use.
     *
     * The template is SNAPSHOTTED into the review: the form will change, and
     * without a snapshot a two-year-old review renders against today's questions
     * and stops meaning what it said.
     */
    async openReview(user: HrUser, cycleId: number) {
        const cycle = await this.loadCycleScoped(user, cycleId);
        const existing = await this.reviews.findOne({ where: { cycleId } });
        const template = cycle.templateId
            ? await this.templates.findOne({ where: { id: cycle.templateId } })
            : await this.templateFor(cycle.tenantId, cycle.cycleType);

        let review = existing;
        if (!review) {
            review = await this.reviews.save(
                this.reviews.create({
                    tenantId: cycle.tenantId,
                    cycleId: cycle.id,
                    employeeId: cycle.employeeId,
                    reviewerUserId: user.id,
                    templateSnapshot: template?.schema ?? {},
                    answers: {},
                    status: 'draft',
                }),
            );
            if (cycle.status === 'scheduled') {
                await this.cycles.update(
                    { id: cycle.id },
                    { status: 'in_progress', reviewerUserId: user.id },
                );
            }
        }

        // Everything a reviewer needs beside the form: the history, and whether
        // the employee is training-ready for a promotion.
        const employee = await this.employeesService.findOne(
            user,
            cycle.employeeId,
        );
        const trainings = await this.training.employeeTrainings(
            user,
            cycle.employeeId,
        );

        return {
            cycle: {
                id: cycle.id,
                cycle_type: cycle.cycleType,
                is_scheduled: cycle.origin === 'system',
                ad_hoc_reason: cycle.adHocReason,
                period_from: cycle.periodFrom,
                period_to: cycle.periodTo,
                due_date: cycle.dueDate,
                status: cycle.status,
            },
            review: this.serializeReview(review),
            template: review.templateSnapshot,
            employee,
            trainings,
        };
    }

    async saveDraft(
        user: HrUser,
        cycleId: number,
        dto: {
            answers?: Record<string, unknown>;
            strengths?: string;
            improvements?: string;
            reviewer_comments?: string;
        },
    ) {
        const cycle = await this.loadCycleScoped(user, cycleId);
        const review = await this.reviews.findOne({ where: { cycleId } });
        if (!review) throw new NotFoundException('Open the review first');
        if (review.status === 'approved') {
            throw new BadRequestException(
                'This review is approved and can no longer be edited',
            );
        }

        const answers = { ...review.answers, ...(dto.answers ?? {}) };
        const scored = scoreReview(
            questionsOf(review.templateSnapshot),
            answers,
        );

        await this.reviews.save({
            id: review.id,
            answers,
            totalScore: scored.totalScore,
            maxScore: scored.maxScore,
            normalizedPercent: scored.normalizedPercent,
            strengths: dto.strengths ?? review.strengths,
            improvements: dto.improvements ?? review.improvements,
            reviewerComments: dto.reviewer_comments ?? review.reviewerComments,
        });
        void cycle;
        return { id: review.id, ...scored };
    }

    /**
     * Submit with a decision.
     *
     * Training gaps for a promotion target are snapshotted here and WARN only —
     * the client chose not to block (decision #16), so a reviewer can promote
     * someone with an outstanding course as long as the gap is on record.
     */
    async submitReview(
        user: HrUser,
        cycleId: number,
        dto: {
            outcome: string;
            promoted_to_designation_id?: number;
            new_basic_amount?: number;
            effective_from?: string;
            strengths?: string;
            improvements?: string;
            reviewer_comments?: string;
        },
    ) {
        const cycle = await this.loadCycleScoped(user, cycleId);
        const review = await this.reviews.findOne({ where: { cycleId } });
        if (!review) throw new NotFoundException('Open the review first');
        if (review.status === 'approved') {
            throw new BadRequestException('This review is already approved');
        }

        const effects = outcomeEffects(dto.outcome);
        if (effects.changesDesignation && !dto.promoted_to_designation_id) {
            throw new BadRequestException(
                'A promotion needs a target designation',
            );
        }

        let gaps: Array<Record<string, unknown>> = [];
        if (dto.promoted_to_designation_id) {
            const readiness = await this.training.readinessFor(
                user,
                cycle.employeeId,
                dto.promoted_to_designation_id,
            );
            gaps = readiness.missing as unknown as Array<
                Record<string, unknown>
            >;
        }

        await this.reviews.save({
            id: review.id,
            outcome: dto.outcome,
            promotedToDesignationId: dto.promoted_to_designation_id ?? null,
            newBasicAmount: dto.new_basic_amount ?? null,
            effectiveFrom: dto.effective_from ?? null,
            strengths: dto.strengths ?? review.strengths,
            improvements: dto.improvements ?? review.improvements,
            reviewerComments: dto.reviewer_comments ?? review.reviewerComments,
            trainingGaps: gaps,
            status: 'submitted',
            submittedAt: new Date(),
        });
        await this.cycles.update({ id: cycleId }, { status: 'submitted' });

        return {
            id: review.id,
            status: 'submitted',
            /** Advisory: a gap warns, it never blocks. */
            training_gaps: gaps,
        };
    }

    /**
     * Approve, and apply the outcome.
     *
     * One transaction writes the new assignment, the new salary structure and
     * the timeline entries — which is what makes a promotion a state change with
     * a paper trail rather than a note in a text field.
     */
    async approveReview(user: HrUser, cycleId: number) {
        if (!hasPermission(user, Permissions.REVIEWS_APPROVE)) {
            throw new ForbiddenException(
                'Approving a review requires reviews:approve',
            );
        }
        const cycle = await this.loadCycleScoped(user, cycleId);
        const review = await this.reviews.findOne({ where: { cycleId } });
        if (!review) throw new NotFoundException('Review not found');
        if (review.status !== 'submitted') {
            throw new BadRequestException(
                `A ${review.status} review cannot be approved`,
            );
        }

        const employee = await this.employees.findOne({
            where: { id: review.employeeId },
        });
        if (!employee) throw new NotFoundException('Employee not found');

        const effects = outcomeEffects(review.outcome ?? 'no_promotion');
        const effectiveFrom =
            review.effectiveFrom ?? new Date().toISOString().slice(0, 10);
        const applied: string[] = [];

        await this.dataSource.transaction(async (manager) => {
            if (effects.changesDesignation && review.promotedToDesignationId) {
                const current = await manager
                    .getRepository(EmployeeAssignment)
                    .findOne({
                        where: {
                            employeeId: employee.id,
                            effectiveTo: IsNull(),
                        },
                    });
                const designation = await manager
                    .getRepository(Designation)
                    .findOne({
                        where: { id: review.promotedToDesignationId },
                    });

                if (current && designation) {
                    const closeOn = new Date(`${effectiveFrom}T00:00:00Z`);
                    closeOn.setUTCDate(closeOn.getUTCDate() - 1);
                    await manager.getRepository(EmployeeAssignment).update(
                        { id: current.id },
                        {
                            effectiveTo: closeOn.toISOString().slice(0, 10),
                        },
                    );
                    const next = await manager
                        .getRepository(EmployeeAssignment)
                        .save(
                            manager.getRepository(EmployeeAssignment).create({
                                tenantId: employee.tenantId,
                                employeeId: employee.id,
                                branchId: current.branchId,
                                brandId: current.brandId,
                                designationId: designation.id,
                                employmentType: current.employmentType,
                                effectiveFrom,
                                effectiveTo: null,
                                changeReason: 'promotion',
                                // The link back to the decision, so the history
                                // says WHY the promotion happened.
                                sourceReviewId: review.id,
                                createdBy: user.id,
                            }),
                        );
                    applied.push(`assignment #${next.id}`);

                    await this.employeesService.writeEvent(manager, {
                        tenantId: employee.tenantId,
                        employeeId: employee.id,
                        eventType: 'promoted',
                        eventDate: effectiveFrom,
                        title: `Promoted to ${designation.name}`,
                        description: review.reviewerComments,
                        refTable: 'employee_reviews',
                        refId: review.id,
                        payload: { review_id: review.id },
                        createdBy: user.id,
                    });
                }
            }

            if (effects.changesSalary && review.newBasicAmount != null) {
                const current = await manager
                    .getRepository(EmployeeSalaryStructure)
                    .findOne({
                        where: {
                            employeeId: employee.id,
                            effectiveTo: IsNull(),
                        },
                    });
                if (current) {
                    const closeOn = new Date(`${effectiveFrom}T00:00:00Z`);
                    closeOn.setUTCDate(closeOn.getUTCDate() - 1);
                    await manager.getRepository(EmployeeSalaryStructure).update(
                        { id: current.id },
                        {
                            effectiveTo: closeOn.toISOString().slice(0, 10),
                        },
                    );
                }
                const structure = await manager
                    .getRepository(EmployeeSalaryStructure)
                    .save(
                        manager.getRepository(EmployeeSalaryStructure).create({
                            tenantId: employee.tenantId,
                            employeeId: employee.id,
                            effectiveFrom,
                            effectiveTo: null,
                            payType: current?.payType ?? 'monthly',
                            basicAmount: review.newBasicAmount,
                            currency: current?.currency ?? 'PKR',
                            dailyRateBasis:
                                current?.dailyRateBasis ?? 'fixed_30',
                            perDeliveredOrderAmount:
                                current?.perDeliveredOrderAmount ?? 0,
                            changeReason:
                                review.outcome === 'promoted'
                                    ? 'promotion'
                                    : 'increment',
                            sourceReviewId: review.id,
                            approvedBy: user.id,
                            approvedAt: new Date(),
                            createdBy: user.id,
                        }),
                    );
                applied.push(`salary #${structure.id}`);

                await this.employeesService.writeEvent(manager, {
                    tenantId: employee.tenantId,
                    employeeId: employee.id,
                    eventType: 'salary_changed',
                    eventDate: effectiveFrom,
                    title: 'Salary revised at review',
                    refTable: 'employee_reviews',
                    refId: review.id,
                    payload: { review_id: review.id },
                    createdBy: user.id,
                });
            }

            await this.employeesService.writeEvent(manager, {
                tenantId: employee.tenantId,
                employeeId: employee.id,
                eventType: 'review_completed',
                eventDate: effectiveFrom,
                title: `Review completed — ${(review.outcome ?? 'no_promotion').replace('_', ' ')}`,
                description: review.reviewerComments,
                refTable: 'employee_reviews',
                refId: review.id,
                payload: {
                    outcome: review.outcome,
                    score: Number(review.normalizedPercent ?? 0),
                    // Recorded so the history distinguishes an out-of-cycle
                    // review from one that satisfied the cadence.
                    is_scheduled: cycle.origin === 'system',
                },
                createdBy: user.id,
            });

            await manager.getRepository(EmployeeReview).update(
                { id: review.id },
                {
                    status: 'approved',
                    approvedBy: user.id,
                    approvedAt: new Date(),
                    effectiveFrom,
                },
            );
            await manager
                .getRepository(ReviewCycle)
                .update({ id: cycleId }, { status: 'approved' });
        });

        await this.audit.record({
            tenantId: employee.tenantId,
            actorUserId: user.id,
            action: 'review.approved',
            entityTable: 'employee_reviews',
            entityId: review.id,
            after: {
                outcome: review.outcome,
                applied,
                training_gaps: review.trainingGaps,
            },
        });

        return { id: review.id, status: 'approved', applied };
    }

    // ------------------------------------------------------------- helpers

    private serializeReview(review: EmployeeReview) {
        return {
            id: review.id,
            answers: review.answers,
            total_score: Number(review.totalScore),
            max_score: Number(review.maxScore),
            normalized_percent:
                review.normalizedPercent != null
                    ? Number(review.normalizedPercent)
                    : null,
            strengths: review.strengths,
            improvements: review.improvements,
            reviewer_comments: review.reviewerComments,
            outcome: review.outcome,
            promoted_to_designation_id: review.promotedToDesignationId,
            new_basic_amount:
                review.newBasicAmount != null
                    ? Number(review.newBasicAmount)
                    : null,
            effective_from: review.effectiveFrom,
            training_gaps: review.trainingGaps,
            status: review.status,
            submitted_at: review.submittedAt,
            approved_at: review.approvedAt,
        };
    }

    private async loadCycleScoped(
        user: HrUser,
        cycleId: number,
    ): Promise<ReviewCycle> {
        const cycle = await this.cycles.findOne({ where: { id: cycleId } });
        if (!cycle) throw new NotFoundException('Review cycle not found');
        if (user.tenantId != null && cycle.tenantId !== user.tenantId) {
            throw new NotFoundException('Review cycle not found');
        }
        // Reuses the employee scoping, including the brand-null rule.
        await this.employeesService.loadScoped(user, cycle.employeeId);
        return cycle;
    }

    listTemplates(user: HrUser) {
        return this.templates.find({
            where: user.tenantId != null ? { tenantId: user.tenantId } : {},
            order: { id: 'ASC' },
        });
    }
}
