import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Employee } from '../entities/employee.entity';
import { EmployeeAssignment } from '../entities/employee-assignment.entity';
import { EmployeeDocument } from '../entities/employee-document.entity';
import { EmployeeEvent } from '../entities/employee-event.entity';
import { EmployeeWarning } from '../entities/employee-warning.entity';
import { Designation } from '../entities/designation.entity';
import { Branch } from '../entities/branch.entity';
import { Permissions } from '../roles/permissions.dto';
import { HrAuditService } from './hr-audit.service';
import {
    applyEmployeeScope,
    canSeeAssignment,
    hasPermission,
    HrUser,
} from './employee-scope';
import {
    ChangeAssignmentDto,
    CreateEmployeeDto,
    EmployeeQueryDto,
    UpdateEmployeeDto,
} from './dto/employee.dto';
import { EmployeeDocumentDto, EmployeeWarningDto } from './dto/hr-support.dto';

import { assignmentCloseDate, isValidPromotion } from './hr-rules';

@Injectable()
export class EmployeesService {
    constructor(
        @InjectRepository(Employee)
        private readonly employees: Repository<Employee>,
        @InjectRepository(EmployeeAssignment)
        private readonly assignments: Repository<EmployeeAssignment>,
        @InjectRepository(EmployeeDocument)
        private readonly documents: Repository<EmployeeDocument>,
        @InjectRepository(EmployeeEvent)
        private readonly events: Repository<EmployeeEvent>,
        @InjectRepository(EmployeeWarning)
        private readonly warnings: Repository<EmployeeWarning>,
        @InjectRepository(Designation)
        private readonly designations: Repository<Designation>,
        @InjectRepository(Branch)
        private readonly branches: Repository<Branch>,
        private readonly audit: HrAuditService,
        private readonly dataSource: DataSource,
    ) {}

    // ---------------------------------------------------------------- reads

    async list(user: HrUser, query: EmployeeQueryDto) {
        const page = Math.max(1, query.page ?? 1);
        const limit = Math.min(Math.max(1, query.limit ?? 25), 200);

        const qb = this.employees
            .createQueryBuilder('emp')
            // INNER join: an employee with no open assignment is a data bug,
            // and silently listing them unscoped would leak across branches.
            .innerJoin('emp.assignments', 'cur', 'cur.effectiveTo IS NULL')
            .leftJoin('cur.designation', 'des')
            .leftJoin('cur.branch', 'br')
            .leftJoin('cur.brand', 'bnd')
            .select([
                'emp.id',
                'emp.employeeCode',
                'emp.fullName',
                'emp.phone',
                'emp.photoUrl',
                'emp.status',
                'emp.employmentType',
                'emp.dateOfJoining',
                'emp.userId',
                'cur.id',
                'cur.branchId',
                'cur.brandId',
                'cur.designationId',
                'des.name',
                'des.department',
                'br.name',
                'bnd.name',
            ]);

        applyEmployeeScope(qb, user, 'emp', 'cur');

        if (!query.include_inactive) {
            qb.andWhere('emp.status NOT IN (:...goneStatuses)', {
                goneStatuses: ['resigned', 'terminated'],
            });
        }
        if (query.status) {
            qb.andWhere('emp.status = :status', { status: query.status });
        }
        if (query.branch_id) {
            qb.andWhere('cur.branchId = :branchFilter', {
                branchFilter: query.branch_id,
            });
        }
        if (query.brand_id) {
            qb.andWhere('cur.brandId = :brandFilter', {
                brandFilter: query.brand_id,
            });
        }
        if (query.designation_id) {
            qb.andWhere('cur.designationId = :desFilter', {
                desFilter: query.designation_id,
            });
        }
        if (query.search?.trim()) {
            const term = `%${query.search.trim().toLowerCase()}%`;
            qb.andWhere(
                '(LOWER(emp.fullName) LIKE :term OR LOWER(emp.employeeCode) LIKE :term OR emp.phone LIKE :term OR emp.cnic LIKE :term)',
                { term },
            );
        }

        qb.orderBy('emp.fullName', 'ASC')
            .skip((page - 1) * limit)
            .take(limit);

        const [rows, total] = await qb.getManyAndCount();

        return {
            data: rows.map((e) => {
                const cur = e.assignments?.[0];
                return {
                    id: e.id,
                    employee_code: e.employeeCode,
                    full_name: e.fullName,
                    phone: e.phone,
                    photo_url: e.photoUrl,
                    status: e.status,
                    employment_type: e.employmentType,
                    date_of_joining: e.dateOfJoining,
                    has_login: e.userId != null,
                    branch: cur?.branch
                        ? { id: cur.branchId, name: cur.branch.name }
                        : null,
                    brand: cur?.brand
                        ? { id: cur.brandId, name: cur.brand.name }
                        : null,
                    designation: cur?.designation
                        ? {
                              id: cur.designationId,
                              name: cur.designation.name,
                              department: cur.designation.department,
                          }
                        : null,
                };
            }),
            meta: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }

    /**
     * The Employee 360 payload: profile, current assignment, full assignment
     * history, timeline, documents, warnings.
     *
     * Bank details are stripped unless the caller holds `salary:view`. They are
     * removed from the object rather than nulled, so a UI cannot accidentally
     * render an empty "Account number" row and imply none is on file.
     */
    async findOne(user: HrUser, id: number) {
        const employee = await this.loadScoped(user, id);

        const [assignments, timeline, documents, warnings] = await Promise.all([
            this.assignments.find({
                where: { employeeId: id },
                relations: ['designation', 'branch', 'brand', 'creator'],
                order: { effectiveFrom: 'DESC', id: 'DESC' },
            }),
            this.events.find({
                where: { employeeId: id },
                relations: ['creator'],
                order: { eventDate: 'DESC', id: 'DESC' },
                take: 200,
            }),
            this.documents.find({
                where: { employeeId: id },
                order: { createdAt: 'DESC' },
            }),
            this.warnings.find({
                where: { employeeId: id },
                relations: ['issuer'],
                order: { issuedOn: 'DESC' },
            }),
        ]);

        const current = assignments.find((a) => a.effectiveTo == null) ?? null;
        const canSeeSalary = hasPermission(user, Permissions.SALARY_VIEW);
        const canSeeDocs = hasPermission(user, Permissions.EMPLOYEE_DOCS_VIEW);

        const profile: Record<string, unknown> = {
            id: employee.id,
            employee_code: employee.employeeCode,
            full_name: employee.fullName,
            father_name: employee.fatherName,
            cnic: employee.cnic,
            date_of_birth: employee.dateOfBirth,
            gender: employee.gender,
            phone: employee.phone,
            address: employee.address,
            emergency_contact_name: employee.emergencyContactName,
            emergency_contact_phone: employee.emergencyContactPhone,
            photo_url: employee.photoUrl,
            user_id: employee.userId,
            has_login: employee.userId != null,
            employment_type: employee.employmentType,
            date_of_joining: employee.dateOfJoining,
            probation_end_date: employee.probationEndDate,
            confirmation_date: employee.confirmationDate,
            status: employee.status,
            date_of_leaving: employee.dateOfLeaving,
            leaving_reason: employee.leavingReason,
            rehire_eligible: employee.rehireEligible,
            has_pin: employee.pinHash != null,
        };
        if (canSeeSalary) {
            profile.bank_name = employee.bankName;
            profile.account_title = employee.accountTitle;
            profile.account_number_iban = employee.accountNumberIban;
            profile.payment_method = employee.paymentMethod;
        }

        return {
            ...profile,
            current_assignment: current
                ? this.serializeAssignment(current)
                : null,
            assignments: assignments.map((a) => this.serializeAssignment(a)),
            timeline: timeline.map((e) => ({
                id: e.id,
                event_type: e.eventType,
                event_date: e.eventDate,
                title: e.title,
                description: e.description,
                ref_table: e.refTable,
                ref_id: e.refId,
                payload: e.payload,
                created_by: e.creator
                    ? { id: e.creator.id, name: e.creator.name }
                    : null,
                created_at: e.createdAt,
            })),
            documents: canSeeDocs
                ? documents.map((d) => ({
                      id: d.id,
                      doc_type: d.docType,
                      file_url: d.fileUrl,
                      document_number: d.documentNumber,
                      issued_on: d.issuedOn,
                      expires_on: d.expiresOn,
                      note: d.note,
                  }))
                : [],
            warnings: warnings.map((w) => ({
                id: w.id,
                warning_type: w.warningType,
                severity: w.severity,
                issued_on: w.issuedOn,
                reason: w.reason,
                document_url: w.documentUrl,
                issued_by: w.issuer
                    ? { id: w.issuer.id, name: w.issuer.name }
                    : null,
            })),
        };
    }

    // --------------------------------------------------------------- writes

    /**
     * Create the employee AND their hire assignment in one transaction.
     *
     * There is deliberately no way to create an employee without an assignment:
     * a person with no branch is invisible to every scoped query and would be
     * silently unmanageable.
     */
    async create(user: HrUser, dto: CreateEmployeeDto) {
        const tenantId = this.requireTenant(user);
        await this.assertBranchAllowed(user, dto.branch_id);
        await this.assertDesignation(tenantId, dto.designation_id);

        if (dto.brand_id != null && user.allowedBrandIds != null) {
            if (!user.allowedBrandIds.includes(dto.brand_id)) {
                throw new BadRequestException(
                    'You cannot assign an employee to that brand',
                );
            }
        }

        return this.dataSource.transaction(async (manager) => {
            const code =
                dto.employee_code?.trim() ||
                (await this.nextEmployeeCode(manager, tenantId));

            const clash = await manager.getRepository(Employee).findOne({
                where: { tenantId, employeeCode: code },
                select: { id: true },
            });
            if (clash) {
                throw new ConflictException(
                    `Employee code ${code} is already in use`,
                );
            }
            if (dto.user_id != null) {
                const linked = await manager.getRepository(Employee).findOne({
                    where: { userId: dto.user_id },
                    select: { id: true, fullName: true },
                });
                if (linked) {
                    throw new ConflictException(
                        `That login is already linked to employee ${linked.fullName}`,
                    );
                }
            }

            const employee = await manager.getRepository(Employee).save(
                manager.getRepository(Employee).create({
                    tenantId,
                    employeeCode: code,
                    fullName: dto.full_name.trim(),
                    fatherName: dto.father_name ?? null,
                    cnic: dto.cnic ?? null,
                    dateOfBirth: dto.date_of_birth ?? null,
                    gender: dto.gender ?? null,
                    phone: dto.phone ?? null,
                    address: dto.address ?? null,
                    emergencyContactName: dto.emergency_contact_name ?? null,
                    emergencyContactPhone: dto.emergency_contact_phone ?? null,
                    photoUrl: dto.photo_url ?? null,
                    userId: dto.user_id ?? null,
                    primaryBranchId: dto.branch_id,
                    employmentType: dto.employment_type ?? 'full_time',
                    dateOfJoining: dto.date_of_joining,
                    probationEndDate: dto.probation_end_date ?? null,
                    status: 'active',
                    bankName: dto.bank_name ?? null,
                    accountTitle: dto.account_title ?? null,
                    accountNumberIban: dto.account_number_iban ?? null,
                    paymentMethod: dto.payment_method ?? 'cash',
                }),
            );

            await manager.getRepository(EmployeeAssignment).save(
                manager.getRepository(EmployeeAssignment).create({
                    tenantId,
                    employeeId: employee.id,
                    branchId: dto.branch_id,
                    brandId: dto.brand_id ?? null,
                    designationId: dto.designation_id,
                    employmentType: dto.employment_type ?? 'full_time',
                    effectiveFrom: dto.date_of_joining,
                    effectiveTo: null,
                    changeReason: 'hire',
                    createdBy: user.id,
                }),
            );

            const designation = await manager
                .getRepository(Designation)
                .findOne({ where: { id: dto.designation_id } });

            await this.writeEvent(manager, {
                tenantId,
                employeeId: employee.id,
                eventType: 'hired',
                eventDate: dto.date_of_joining,
                title: `Hired as ${designation?.name ?? 'staff'}`,
                refTable: 'employees',
                refId: employee.id,
                payload: {
                    branch_id: dto.branch_id,
                    brand_id: dto.brand_id ?? null,
                    designation_id: dto.designation_id,
                },
                createdBy: user.id,
            });

            await this.audit.record(
                {
                    tenantId,
                    actorUserId: user.id,
                    action: 'employee.create',
                    entityTable: 'employees',
                    entityId: employee.id,
                    after: {
                        employee_code: code,
                        full_name: employee.fullName,
                    },
                },
                manager,
            );

            return { id: employee.id, employee_code: code };
        });
    }

    async update(user: HrUser, id: number, dto: UpdateEmployeeDto) {
        const employee = await this.loadScoped(user, id);
        const tenantId = this.requireTenant(user);

        // Bank details are salary data: editing them requires salary:edit even
        // though they sit on the employee row.
        const touchesBank =
            dto.bank_name !== undefined ||
            dto.account_title !== undefined ||
            dto.account_number_iban !== undefined ||
            dto.payment_method !== undefined;
        if (touchesBank && !hasPermission(user, Permissions.SALARY_EDIT)) {
            throw new BadRequestException(
                'Editing payment details requires the salary:edit permission',
            );
        }

        if (dto.user_id != null && dto.user_id !== employee.userId) {
            const linked = await this.employees.findOne({
                where: { userId: dto.user_id },
                select: { id: true, fullName: true },
            });
            if (linked && linked.id !== id) {
                throw new ConflictException(
                    `That login is already linked to employee ${linked.fullName}`,
                );
            }
        }

        const before = { ...employee } as unknown as Record<string, unknown>;
        // Explicit shape rather than Partial<Employee>: the entity's relation
        // and jsonb properties are not assignable to TypeORM's update payload.
        const patch: {
            fullName?: string;
            fatherName?: string | null;
            cnic?: string | null;
            dateOfBirth?: string | null;
            gender?: string | null;
            phone?: string | null;
            address?: string | null;
            emergencyContactName?: string | null;
            emergencyContactPhone?: string | null;
            photoUrl?: string | null;
            userId?: number | null;
            probationEndDate?: string | null;
            confirmationDate?: string | null;
            status?: string;
            bankName?: string | null;
            accountTitle?: string | null;
            accountNumberIban?: string | null;
            paymentMethod?: string;
        } = {};
        const map: Array<[keyof UpdateEmployeeDto, keyof typeof patch]> = [
            ['full_name', 'fullName'],
            ['father_name', 'fatherName'],
            ['cnic', 'cnic'],
            ['date_of_birth', 'dateOfBirth'],
            ['gender', 'gender'],
            ['phone', 'phone'],
            ['address', 'address'],
            ['emergency_contact_name', 'emergencyContactName'],
            ['emergency_contact_phone', 'emergencyContactPhone'],
            ['photo_url', 'photoUrl'],
            ['user_id', 'userId'],
            ['probation_end_date', 'probationEndDate'],
            ['confirmation_date', 'confirmationDate'],
            ['status', 'status'],
            ['bank_name', 'bankName'],
            ['account_title', 'accountTitle'],
            ['account_number_iban', 'accountNumberIban'],
            ['payment_method', 'paymentMethod'],
        ];
        for (const [from, to] of map) {
            if (dto[from] !== undefined) {
                (patch as Record<string, unknown>)[to] = dto[from];
            }
        }
        if (Object.keys(patch).length === 0) return { id, updated: false };

        await this.employees.update({ id }, patch);

        const diff = HrAuditService.diff(
            before,
            patch as unknown as Record<string, unknown>,
        );
        await this.audit.record({
            tenantId,
            actorUserId: user.id,
            action: 'employee.update',
            entityTable: 'employees',
            entityId: id,
            before: diff.before,
            after: diff.after,
        });

        return { id, updated: true };
    }

    /**
     * Promotion, demotion, transfer, confirmation — closes the current
     * assignment and opens a new one.
     *
     * The current row is closed the day BEFORE `effective_from`, so the history
     * has no overlap and no gap. Both rows are written in one transaction
     * because the partial unique index (one open assignment per employee) would
     * otherwise reject the insert and leave the employee with none.
     */
    async changeAssignment(user: HrUser, id: number, dto: ChangeAssignmentDto) {
        const employee = await this.loadScoped(user, id);
        const tenantId = this.requireTenant(user);

        if (['resigned', 'terminated'].includes(employee.status)) {
            throw new BadRequestException(
                'This employee has left. Reinstate them before changing the assignment.',
            );
        }

        const current = await this.assignments.findOne({
            where: { employeeId: id, effectiveTo: null as unknown as string },
            relations: ['designation'],
        });
        if (!current) {
            throw new BadRequestException(
                'Employee has no open assignment to change',
            );
        }

        if (dto.effective_from <= current.effectiveFrom) {
            throw new BadRequestException(
                `Effective date must be after the current assignment started (${current.effectiveFrom})`,
            );
        }

        const branchId = dto.branch_id ?? current.branchId;
        const brandId =
            dto.brand_id === undefined ? current.brandId : dto.brand_id;
        const designationId = dto.designation_id ?? current.designationId;

        await this.assertBranchAllowed(user, branchId);
        const designation = await this.assertDesignation(
            tenantId,
            designationId,
        );

        if (
            dto.change_reason === 'promotion' &&
            current.designation &&
            !isValidPromotion(current.designation.level, designation.level)
        ) {
            throw new BadRequestException(
                `A promotion must move up the ladder: ${designation.name} (level ${designation.level}) is not senior to ${current.designation.name} (level ${current.designation.level})`,
            );
        }

        return this.dataSource.transaction(async (manager) => {
            await manager
                .getRepository(EmployeeAssignment)
                .update(
                    { id: current.id },
                    { effectiveTo: assignmentCloseDate(dto.effective_from) },
                );

            const next = await manager.getRepository(EmployeeAssignment).save(
                manager.getRepository(EmployeeAssignment).create({
                    tenantId,
                    employeeId: id,
                    branchId,
                    brandId,
                    designationId,
                    employmentType:
                        dto.employment_type ?? current.employmentType,
                    effectiveFrom: dto.effective_from,
                    effectiveTo: null,
                    changeReason: dto.change_reason,
                    note: dto.note ?? null,
                    createdBy: user.id,
                }),
            );

            // Keep the convenience column in step with the assignment that is
            // now current, or the roster's default branch drifts after a
            // transfer.
            if (branchId !== employee.primaryBranchId) {
                await manager
                    .getRepository(Employee)
                    .update({ id }, { primaryBranchId: branchId });
            }
            if (dto.change_reason === 'confirmation') {
                await manager
                    .getRepository(Employee)
                    .update({ id }, { confirmationDate: dto.effective_from });
            }

            await this.writeEvent(manager, {
                tenantId,
                employeeId: id,
                eventType: this.eventTypeForChange(dto.change_reason),
                eventDate: dto.effective_from,
                title: this.titleForChange(
                    dto.change_reason,
                    current.designation?.name ?? null,
                    designation.name,
                ),
                description: dto.note ?? null,
                refTable: 'employee_assignments',
                refId: next.id,
                payload: {
                    from: {
                        branch_id: current.branchId,
                        brand_id: current.brandId,
                        designation_id: current.designationId,
                    },
                    to: {
                        branch_id: branchId,
                        brand_id: brandId,
                        designation_id: designationId,
                    },
                },
                createdBy: user.id,
            });

            await this.audit.record(
                {
                    tenantId,
                    actorUserId: user.id,
                    action: `employee.${dto.change_reason}`,
                    entityTable: 'employee_assignments',
                    entityId: next.id,
                    before: {
                        branch_id: current.branchId,
                        brand_id: current.brandId,
                        designation_id: current.designationId,
                    },
                    after: {
                        branch_id: branchId,
                        brand_id: brandId,
                        designation_id: designationId,
                    },
                },
                manager,
            );

            return { id: next.id };
        });
    }

    // ------------------------------------------------------ documents etc.

    async addDocument(user: HrUser, id: number, dto: EmployeeDocumentDto) {
        await this.loadScoped(user, id);
        const tenantId = this.requireTenant(user);
        const doc = await this.documents.save(
            this.documents.create({
                tenantId,
                employeeId: id,
                docType: dto.doc_type,
                fileUrl: dto.file_url,
                documentNumber: dto.document_number ?? null,
                issuedOn: dto.issued_on ?? null,
                expiresOn: dto.expires_on ?? null,
                note: dto.note ?? null,
            }),
        );
        await this.audit.record({
            tenantId,
            actorUserId: user.id,
            action: 'employee.document.add',
            entityTable: 'employee_documents',
            entityId: doc.id,
            after: { employee_id: id, doc_type: dto.doc_type },
        });
        return { id: doc.id };
    }

    async removeDocument(user: HrUser, id: number, documentId: number) {
        await this.loadScoped(user, id);
        const doc = await this.documents.findOne({
            where: { id: documentId, employeeId: id },
        });
        if (!doc) throw new NotFoundException('Document not found');
        await this.documents.delete({ id: documentId });
        await this.audit.record({
            tenantId: this.requireTenant(user),
            actorUserId: user.id,
            action: 'employee.document.remove',
            entityTable: 'employee_documents',
            entityId: documentId,
            before: { employee_id: id, doc_type: doc.docType },
        });
        return { deleted: true };
    }

    async addWarning(user: HrUser, id: number, dto: EmployeeWarningDto) {
        await this.loadScoped(user, id);
        const tenantId = this.requireTenant(user);

        return this.dataSource.transaction(async (manager) => {
            const warning = await manager.getRepository(EmployeeWarning).save(
                manager.getRepository(EmployeeWarning).create({
                    tenantId,
                    employeeId: id,
                    warningType: dto.warning_type,
                    severity: dto.severity ?? 'low',
                    issuedBy: user.id,
                    issuedOn: dto.issued_on,
                    reason: dto.reason,
                    documentUrl: dto.document_url ?? null,
                }),
            );

            await this.writeEvent(manager, {
                tenantId,
                employeeId: id,
                eventType: 'warning_issued',
                eventDate: dto.issued_on,
                title: `Warning issued (${dto.severity ?? 'low'})`,
                description: dto.reason,
                refTable: 'employee_warnings',
                refId: warning.id,
                payload: { warning_type: dto.warning_type },
                createdBy: user.id,
            });

            return { id: warning.id };
        });
    }

    // -------------------------------------------------------------- helpers

    /** Load an employee the caller is actually allowed to see, or 404. */
    async loadScoped(user: HrUser, id: number): Promise<Employee> {
        const employee = await this.employees.findOne({ where: { id } });
        if (!employee) throw new NotFoundException('Employee not found');
        if (user.tenantId != null && employee.tenantId !== user.tenantId) {
            throw new NotFoundException('Employee not found');
        }

        const current = await this.assignments.findOne({
            where: { employeeId: id, effectiveTo: null as unknown as string },
        });
        // A left employee has no open assignment; fall back to their last one so
        // history stays reachable without widening who can see it.
        const reference =
            current ??
            (await this.assignments.findOne({
                where: { employeeId: id },
                order: { effectiveFrom: 'DESC', id: 'DESC' },
            }));
        if (reference && !canSeeAssignment(reference, user)) {
            throw new NotFoundException('Employee not found');
        }
        return employee;
    }

    private serializeAssignment(a: EmployeeAssignment) {
        return {
            id: a.id,
            branch: a.branch
                ? { id: a.branchId, name: a.branch.name }
                : { id: a.branchId, name: null },
            brand: a.brand ? { id: a.brandId, name: a.brand.name } : null,
            designation: a.designation
                ? {
                      id: a.designationId,
                      name: a.designation.name,
                      level: a.designation.level,
                      department: a.designation.department,
                  }
                : null,
            employment_type: a.employmentType,
            effective_from: a.effectiveFrom,
            effective_to: a.effectiveTo,
            is_current: a.effectiveTo == null,
            change_reason: a.changeReason,
            note: a.note,
            created_by: a.creator
                ? { id: a.creator.id, name: a.creator.name }
                : null,
        };
    }

    /** Shared by every module that appends to the timeline. */
    async writeEvent(
        manager: EntityManager,
        event: {
            tenantId: number;
            employeeId: number;
            eventType: string;
            eventDate: string;
            title: string;
            description?: string | null;
            refTable?: string | null;
            refId?: number | null;
            payload?: Record<string, unknown>;
            createdBy?: number | null;
        },
    ) {
        const repo = manager.getRepository(EmployeeEvent);
        await repo.save(
            repo.create({
                tenantId: event.tenantId,
                employeeId: event.employeeId,
                eventType: event.eventType,
                eventDate: event.eventDate,
                title: event.title,
                description: event.description ?? null,
                refTable: event.refTable ?? null,
                refId: event.refId ?? null,
                payload: event.payload ?? {},
                createdBy: event.createdBy ?? null,
            }),
        );
    }

    private eventTypeForChange(reason: string): string {
        switch (reason) {
            case 'promotion':
                return 'promoted';
            case 'demotion':
                return 'demoted';
            case 'transfer_branch':
                return 'transferred_branch';
            case 'transfer_brand':
                return 'transferred_brand';
            case 'confirmation':
                return 'confirmed';
            default:
                return 'designation_changed';
        }
    }

    private titleForChange(
        reason: string,
        fromName: string | null,
        toName: string,
    ): string {
        if (reason === 'promotion')
            return `Promoted${fromName ? ` from ${fromName}` : ''} to ${toName}`;
        if (reason === 'demotion')
            return `Moved${fromName ? ` from ${fromName}` : ''} to ${toName}`;
        if (reason === 'transfer_branch')
            return 'Transferred to another branch';
        if (reason === 'transfer_brand') return 'Transferred to another brand';
        if (reason === 'confirmation') return 'Confirmed after probation';
        return `Designation changed to ${toName}`;
    }

    private requireTenant(user: HrUser): number {
        if (user.tenantId == null) {
            throw new BadRequestException(
                'Super admin must act within a tenant for HR operations',
            );
        }
        return user.tenantId;
    }

    /**
     * `branches` carries no tenant_id — a branch belongs to a tenant only
     * through the brands linked to it (branch_brands → brands.tenant_id), which
     * is the platform's Tenant → {Brand, Branch} model. Checking a
     * `branch.tenantId` that does not exist would compile away to nothing and
     * silently allow cross-tenant hiring, so the join is the check.
     */
    private async assertBranchAllowed(user: HrUser, branchId: number) {
        const qb = this.branches
            .createQueryBuilder('b')
            .select('b.id')
            .where('b.id = :branchId', { branchId });
        if (user.tenantId != null) {
            qb.innerJoin('b.branchBrands', 'bb')
                .innerJoin('bb.brand', 'brand')
                .andWhere('brand.tenantId = :tenantId', {
                    tenantId: user.tenantId,
                });
        }
        const branch = await qb.getOne();
        if (!branch) throw new BadRequestException('Branch not found');
        if (
            user.allowedBranchIds != null &&
            !user.allowedBranchIds.includes(branchId)
        ) {
            throw new BadRequestException(
                'You do not have access to that branch',
            );
        }
    }

    private async assertDesignation(
        tenantId: number,
        designationId: number,
    ): Promise<Designation> {
        const designation = await this.designations.findOne({
            where: { id: designationId, tenantId },
        });
        if (!designation) {
            throw new BadRequestException('Designation not found');
        }
        return designation;
    }

    /**
     * EMP-0001, EMP-0002, … per tenant. Computed inside the caller's
     * transaction and protected by the (tenant_id, employee_code) unique
     * constraint, so a concurrent create fails loudly rather than duplicating.
     */
    private async nextEmployeeCode(
        manager: EntityManager,
        tenantId: number,
    ): Promise<string> {
        const rows = await manager.query<Array<{ max: string | null }>>(
            `SELECT MAX(CAST(NULLIF(regexp_replace(employee_code, '\\D', '', 'g'), '') AS integer)) AS max
             FROM employees WHERE tenant_id = $1`,
            [tenantId],
        );
        const next = Number(rows?.[0]?.max ?? 0) + 1;
        return `EMP-${String(next).padStart(4, '0')}`;
    }
}
