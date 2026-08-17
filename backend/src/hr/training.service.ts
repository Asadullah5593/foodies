import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrainingProgram } from '../entities/training-program.entity';
import { EmployeeTraining } from '../entities/employee-training.entity';
import { DesignationTrainingRequirement } from '../entities/designation-training-requirement.entity';
import { EmployeesService } from './employees.service';
import { HrAuditService } from './hr-audit.service';
import { HrUser } from './employee-scope';
import { addMonths, trainingReadiness } from './review-rules';

@Injectable()
export class TrainingService {
    private readonly logger = new Logger(TrainingService.name);

    constructor(
        @InjectRepository(TrainingProgram)
        private readonly programs: Repository<TrainingProgram>,
        @InjectRepository(EmployeeTraining)
        private readonly records: Repository<EmployeeTraining>,
        @InjectRepository(DesignationTrainingRequirement)
        private readonly requirements: Repository<DesignationTrainingRequirement>,
        private readonly employeesService: EmployeesService,
        private readonly audit: HrAuditService,
    ) {}

    // ------------------------------------------------------------- programs

    listPrograms(user: HrUser, includeInactive = false) {
        const qb = this.programs
            .createQueryBuilder('p')
            .orderBy('p.category', 'ASC')
            .addOrderBy('p.level', 'ASC')
            .addOrderBy('p.name', 'ASC');
        if (user.tenantId != null) {
            qb.where('p.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (!includeInactive) qb.andWhere('p.isActive = true');
        return qb.getMany();
    }

    async createProgram(
        user: HrUser,
        dto: {
            name: string;
            code?: string;
            category?: string;
            level?: number;
            duration_hours?: number;
            validity_months?: number;
            is_mandatory?: boolean;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant',
            );
        }
        const code =
            dto.code?.trim() ||
            dto.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
        const clash = await this.programs.findOne({
            where: { tenantId: user.tenantId, code },
        });
        if (clash) {
            throw new BadRequestException(
                `A program with code "${code}" already exists`,
            );
        }
        const saved = await this.programs.save(
            this.programs.create({
                tenantId: user.tenantId,
                name: dto.name.trim(),
                code,
                category: dto.category ?? null,
                level: dto.level ?? 1,
                durationHours: dto.duration_hours ?? 0,
                validityMonths: dto.validity_months ?? null,
                isMandatory: dto.is_mandatory ?? false,
                isActive: true,
            }),
        );
        return { id: saved.id, code };
    }

    // ----------------------------------------------------------- assignment

    async employeeTrainings(user: HrUser, employeeId: number) {
        await this.employeesService.loadScoped(user, employeeId);
        const rows = await this.records.find({
            where: { employeeId },
            relations: ['program'],
            order: { id: 'DESC' },
        });
        const today = new Date().toISOString().slice(0, 10);
        return rows.map((r) => ({
            id: r.id,
            program: {
                id: r.programId,
                name: r.program?.name,
                category: r.program?.category,
                level: r.program?.level,
            },
            status: r.status,
            assigned_on: r.assignedOn,
            completed_on: r.completedOn,
            expires_on: r.expiresOn,
            /** Surfaced live so a certificate about to lapse is visible. */
            expiring_soon:
                r.status === 'completed' &&
                r.expiresOn != null &&
                r.expiresOn >= today &&
                r.expiresOn <= addMonths(today, 1),
            score: r.score != null ? Number(r.score) : null,
            certificate_url: r.certificateUrl,
        }));
    }

    async assign(user: HrUser, employeeId: number, programId: number) {
        const employee = await this.employeesService.loadScoped(
            user,
            employeeId,
        );
        const program = await this.programs.findOne({
            where: { id: programId, tenantId: employee.tenantId },
        });
        if (!program) throw new NotFoundException('Program not found');

        const existing = await this.records.findOne({
            where: { employeeId, programId },
        });
        if (existing) {
            // Re-assigning an expired or failed course restarts it rather than
            // creating a second row: one record per person per program keeps
            // "have they done it" a single answer.
            if (['expired', 'failed'].includes(existing.status)) {
                await this.records.update(
                    { id: existing.id },
                    {
                        status: 'assigned',
                        assignedOn: new Date().toISOString().slice(0, 10),
                        startedOn: null,
                        completedOn: null,
                        expiresOn: null,
                        score: null,
                    },
                );
                return { id: existing.id, restarted: true };
            }
            throw new BadRequestException(
                `Already ${existing.status} for this program`,
            );
        }

        const saved = await this.records.save(
            this.records.create({
                tenantId: employee.tenantId,
                employeeId,
                programId,
                status: 'assigned',
                assignedOn: new Date().toISOString().slice(0, 10),
            }),
        );
        return { id: saved.id, restarted: false };
    }

    /**
     * Record a completion (or a failure).
     *
     * `expiresOn` is computed from the program's validity AT COMPLETION and
     * stored, not derived live — shortening a program's validity later must not
     * retroactively expire certificates people already hold.
     */
    async recordOutcome(
        user: HrUser,
        recordId: number,
        dto: {
            status: 'in_progress' | 'completed' | 'failed';
            completed_on?: string;
            score?: number;
            certificate_url?: string;
            note?: string;
        },
    ) {
        const record = await this.records.findOne({
            where: { id: recordId },
            relations: ['program'],
        });
        if (!record) throw new NotFoundException('Training record not found');
        const employee = await this.employeesService.loadScoped(
            user,
            record.employeeId,
        );

        const patch: {
            status: string;
            startedOn?: string | null;
            completedOn?: string | null;
            expiresOn?: string | null;
            score?: number | null;
            certificateUrl?: string | null;
            note?: string | null;
            verifiedBy?: number | null;
        } = { status: dto.status };

        if (dto.status === 'in_progress') {
            patch.startedOn =
                record.startedOn ?? new Date().toISOString().slice(0, 10);
        }
        if (dto.status === 'completed') {
            const completedOn =
                dto.completed_on ?? new Date().toISOString().slice(0, 10);
            patch.completedOn = completedOn;
            patch.expiresOn = record.program?.validityMonths
                ? addMonths(completedOn, record.program.validityMonths)
                : null;
            patch.verifiedBy = user.id;
        }
        if (dto.score != null) patch.score = dto.score;
        if (dto.certificate_url) patch.certificateUrl = dto.certificate_url;
        if (dto.note) patch.note = dto.note;

        await this.records.update({ id: recordId }, patch);

        if (dto.status === 'completed') {
            await this.audit.record({
                tenantId: employee.tenantId,
                actorUserId: user.id,
                action: 'training.completed',
                entityTable: 'employee_trainings',
                entityId: recordId,
                after: {
                    program: record.program?.name,
                    score: dto.score ?? null,
                    expires_on: patch.expiresOn,
                },
            });
        }

        return {
            id: recordId,
            status: dto.status,
            expires_on: patch.expiresOn,
        };
    }

    // --------------------------------------------------------- requirements

    listRequirements(user: HrUser, designationId?: number) {
        const qb = this.requirements
            .createQueryBuilder('r')
            .leftJoin('r.program', 'p')
            .leftJoin('r.designation', 'd')
            .select([
                'r.id',
                'r.designationId',
                'r.programId',
                'r.requiredFor',
                'r.minScore',
                'p.name',
                'd.name',
            ]);
        if (user.tenantId != null) {
            qb.where('r.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        if (designationId) {
            qb.andWhere('r.designationId = :designationId', { designationId });
        }
        return qb.getMany();
    }

    async setRequirement(
        user: HrUser,
        dto: {
            designation_id: number;
            program_id: number;
            required_for?: 'promotion_into' | 'holding_role';
            min_score?: number;
        },
    ) {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant',
            );
        }
        const requiredFor = dto.required_for ?? 'promotion_into';
        const existing = await this.requirements.findOne({
            where: {
                designationId: dto.designation_id,
                programId: dto.program_id,
                requiredFor,
            },
        });
        if (existing) {
            await this.requirements.update(
                { id: existing.id },
                { minScore: dto.min_score ?? null },
            );
            return { id: existing.id, updated: true };
        }
        const saved = await this.requirements.save(
            this.requirements.create({
                tenantId: user.tenantId,
                designationId: dto.designation_id,
                programId: dto.program_id,
                requiredFor,
                minScore: dto.min_score ?? null,
            }),
        );
        return { id: saved.id, updated: false };
    }

    async removeRequirement(user: HrUser, id: number) {
        const req = await this.requirements.findOne({ where: { id } });
        if (!req) throw new NotFoundException('Requirement not found');
        if (user.tenantId != null && req.tenantId !== user.tenantId) {
            throw new NotFoundException('Requirement not found');
        }
        await this.requirements.delete({ id });
        return { deleted: true };
    }

    /**
     * Is this employee training-ready to move into a designation?
     *
     * ⚠️ Advisory. The client chose a WARNING rather than a block (decision #16),
     * so nothing here prevents a promotion — it only records what is missing.
     */
    async readinessFor(employeeId: number, designationId: number) {
        const required = await this.requirements.find({
            where: { designationId, requiredFor: 'promotion_into' },
            relations: ['program'],
        });
        const records = await this.records.find({ where: { employeeId } });

        return trainingReadiness(
            required.map((r) => ({
                programId: r.programId,
                programName: r.program?.name ?? `Program #${r.programId}`,
                minScore: r.minScore != null ? Number(r.minScore) : null,
            })),
            records.map((r) => ({
                programId: r.programId,
                status: r.status,
                score: r.score != null ? Number(r.score) : null,
            })),
        );
    }

    /**
     * Mark lapsed certificates expired.
     *
     * A completed course that has passed its validity must stop counting toward
     * a promotion, and a food-handler certificate nobody renewed is a regulatory
     * problem — so this runs on a schedule rather than waiting to be noticed.
     */
    async expireLapsedTrainings(): Promise<number> {
        const today = new Date().toISOString().slice(0, 10);
        const result = await this.records
            .createQueryBuilder()
            .update()
            .set({ status: 'expired' })
            .where('status = :status', { status: 'completed' })
            .andWhere('expires_on IS NOT NULL')
            .andWhere('expires_on < :today', { today })
            .execute();
        const affected = result.affected ?? 0;
        if (affected > 0) {
            this.logger.log(`Expired ${affected} lapsed training record(s)`);
        }
        return affected;
    }

    /** Certificates lapsing inside the window, for the alerts panel. */
    expiringSoon(user: HrUser, withinDays = 30) {
        const today = new Date().toISOString().slice(0, 10);
        const cutoff = new Date(Date.now() + withinDays * 86_400_000)
            .toISOString()
            .slice(0, 10);
        const qb = this.records
            .createQueryBuilder('r')
            .leftJoin('r.program', 'p')
            .leftJoin('r.employee', 'e')
            .select([
                'r.id',
                'r.expiresOn',
                'r.status',
                'p.name',
                'e.id',
                'e.fullName',
                'e.employeeCode',
            ])
            .where('r.status = :status', { status: 'completed' })
            .andWhere('r.expiresOn IS NOT NULL')
            .andWhere('r.expiresOn BETWEEN :today AND :cutoff', {
                today,
                cutoff,
            })
            .orderBy('r.expiresOn', 'ASC');
        if (user.tenantId != null) {
            qb.andWhere('r.tenantId = :tenantId', { tenantId: user.tenantId });
        }
        return qb.getMany();
    }
}
