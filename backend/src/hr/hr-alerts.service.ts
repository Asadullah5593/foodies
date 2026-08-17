import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmployeeDocument } from '../entities/employee-document.entity';
import { EmployeeTraining } from '../entities/employee-training.entity';
import { Employee } from '../entities/employee.entity';
import { ReviewCycle } from '../entities/review-cycle.entity';
import {
    NotificationsService,
    SystemAlertItem,
} from '../notifications/notifications.service';
import { HrUser } from './employee-scope';

/** Days of notice each alert type gives. */
export const DOCUMENT_NOTICE_DAYS = 30;
export const TRAINING_NOTICE_DAYS = 30;
export const PROBATION_NOTICE_DAYS = 14;

export type HrAlertRow = {
    kind:
        | 'document_expiring'
        | 'training_expiring'
        | 'probation_ending'
        | 'review_overdue';
    /** Stable per condition, so an alert never duplicates and resolves when it clears. */
    dedupeKey: string;
    tenantId: number;
    branchId: number;
    employeeId: number;
    employeeName: string;
    employeeCode: string;
    /** The date the condition turns on: expiry, probation end, or due date. */
    date: string;
    label: string;
    detail: string | null;
    /** Where the client should go when the alert is opened. */
    link: string;
};

const iso = (offsetDays = 0) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * The things HR would otherwise find out too late.
 *
 * Every query here answers the same shape of question — "what lapses soon, and
 * whose is it" — so they share one row type and one dedupe-key convention. The
 * nightly sweep turns them into system-managed notifications (opened when the
 * condition appears, auto-resolved when it clears), and the same rows back the
 * admin alerts screen, so the bell and the screen can never disagree.
 *
 * Branch comes from the employee's CURRENT assignment: notification recipients
 * are resolved per branch, so an alert without one would reach nobody.
 */
@Injectable()
export class HrAlertsService {
    private readonly logger = new Logger(HrAlertsService.name);

    constructor(
        @InjectRepository(EmployeeDocument)
        private readonly documents: Repository<EmployeeDocument>,
        @InjectRepository(EmployeeTraining)
        private readonly trainings: Repository<EmployeeTraining>,
        @InjectRepository(Employee)
        private readonly employees: Repository<Employee>,
        @InjectRepository(ReviewCycle)
        private readonly cycles: Repository<ReviewCycle>,
        private readonly notifications: NotificationsService,
    ) {}

    // ------------------------------------------------------------- conditions

    async expiringDocuments(tenantId?: number): Promise<HrAlertRow[]> {
        const qb = this.documents
            .createQueryBuilder('d')
            .innerJoin('d.employee', 'emp')
            .innerJoin(
                'employee_assignments',
                'cur',
                'cur.employee_id = emp.id AND cur.effective_to IS NULL',
            )
            .select([
                'd.id AS id',
                'd.doc_type AS doc_type',
                'd.expires_on AS expires_on',
                'd.document_number AS document_number',
                'emp.id AS employee_id',
                'emp.full_name AS employee_name',
                'emp.employee_code AS employee_code',
                'emp.tenant_id AS tenant_id',
                'cur.branch_id AS branch_id',
            ])
            .where('d.expires_on IS NOT NULL')
            .andWhere('d.expires_on <= :cutoff', {
                cutoff: iso(DOCUMENT_NOTICE_DAYS),
            })
            // Already-expired documents stay on the list: the point is to get
            // them renewed, and dropping them the day they lapse would hide the
            // ones nobody acted on.
            .andWhere("emp.status NOT IN ('resigned', 'terminated')");
        if (tenantId != null) {
            qb.andWhere('emp.tenant_id = :tenantId', { tenantId });
        }

        const rows = await qb.getRawMany<{
            id: number;
            doc_type: string;
            expires_on: string;
            document_number: string | null;
            employee_id: number;
            employee_name: string;
            employee_code: string;
            tenant_id: number;
            branch_id: number;
        }>();

        const today = iso();
        return rows.map((r) => ({
            kind: 'document_expiring' as const,
            dedupeKey: `hr.document_expiring:${r.id}:${r.expires_on}`,
            tenantId: Number(r.tenant_id),
            branchId: Number(r.branch_id),
            employeeId: Number(r.employee_id),
            employeeName: r.employee_name,
            employeeCode: r.employee_code,
            date: r.expires_on,
            label: `${r.doc_type.replace(/_/g, ' ')} — ${r.employee_name}`,
            detail:
                r.expires_on < today
                    ? `Expired on ${r.expires_on}`
                    : `Expires ${r.expires_on}`,
            link: `/admin/hr/employees/${r.employee_id}`,
        }));
    }

    async expiringTrainings(tenantId?: number): Promise<HrAlertRow[]> {
        const qb = this.trainings
            .createQueryBuilder('t')
            .innerJoin('t.employee', 'emp')
            .innerJoin('t.program', 'p')
            .innerJoin(
                'employee_assignments',
                'cur',
                'cur.employee_id = emp.id AND cur.effective_to IS NULL',
            )
            .select([
                't.id AS id',
                't.expires_on AS expires_on',
                'p.name AS program_name',
                'emp.id AS employee_id',
                'emp.full_name AS employee_name',
                'emp.employee_code AS employee_code',
                'emp.tenant_id AS tenant_id',
                'cur.branch_id AS branch_id',
            ])
            .where("t.status = 'completed'")
            .andWhere('t.expires_on IS NOT NULL')
            .andWhere('t.expires_on BETWEEN :today AND :cutoff', {
                today: iso(),
                cutoff: iso(TRAINING_NOTICE_DAYS),
            })
            .andWhere("emp.status NOT IN ('resigned', 'terminated')");
        if (tenantId != null) {
            qb.andWhere('emp.tenant_id = :tenantId', { tenantId });
        }

        const rows = await qb.getRawMany<{
            id: number;
            expires_on: string;
            program_name: string;
            employee_id: number;
            employee_name: string;
            employee_code: string;
            tenant_id: number;
            branch_id: number;
        }>();

        return rows.map((r) => ({
            kind: 'training_expiring' as const,
            dedupeKey: `hr.training_expiring:${r.id}:${r.expires_on}`,
            tenantId: Number(r.tenant_id),
            branchId: Number(r.branch_id),
            employeeId: Number(r.employee_id),
            employeeName: r.employee_name,
            employeeCode: r.employee_code,
            date: r.expires_on,
            label: `${r.program_name} — ${r.employee_name}`,
            detail: `Certificate lapses ${r.expires_on}`,
            link: `/admin/hr/employees/${r.employee_id}`,
        }));
    }

    async endingProbations(tenantId?: number): Promise<HrAlertRow[]> {
        const qb = this.employees
            .createQueryBuilder('emp')
            .innerJoin(
                'employee_assignments',
                'cur',
                'cur.employee_id = emp.id AND cur.effective_to IS NULL',
            )
            .select([
                'emp.id AS employee_id',
                'emp.full_name AS employee_name',
                'emp.employee_code AS employee_code',
                'emp.probation_end_date AS probation_end_date',
                'emp.tenant_id AS tenant_id',
                'cur.branch_id AS branch_id',
            ])
            .where('emp.probation_end_date IS NOT NULL')
            .andWhere('emp.confirmation_date IS NULL')
            .andWhere('emp.probation_end_date <= :cutoff', {
                cutoff: iso(PROBATION_NOTICE_DAYS),
            })
            .andWhere("emp.status NOT IN ('resigned', 'terminated')");
        if (tenantId != null) {
            qb.andWhere('emp.tenant_id = :tenantId', { tenantId });
        }

        const rows = await qb.getRawMany<{
            employee_id: number;
            employee_name: string;
            employee_code: string;
            probation_end_date: string;
            tenant_id: number;
            branch_id: number;
        }>();

        const today = iso();
        return rows.map((r) => ({
            kind: 'probation_ending' as const,
            dedupeKey: `hr.probation_ending:${r.employee_id}:${r.probation_end_date}`,
            tenantId: Number(r.tenant_id),
            branchId: Number(r.branch_id),
            employeeId: Number(r.employee_id),
            employeeName: r.employee_name,
            employeeCode: r.employee_code,
            date: r.probation_end_date,
            label: r.employee_name,
            detail:
                r.probation_end_date < today
                    ? `Probation ended ${r.probation_end_date} — still not confirmed`
                    : `Probation ends ${r.probation_end_date}`,
            link: `/admin/hr/employees/${r.employee_id}`,
        }));
    }

    /**
     * Overdue SCHEDULED review cycles.
     *
     * `origin = 'system'` is not an optimisation — an ad-hoc review is extra, and
     * counting one here would make the cadence look worse than it is
     * (docs/HRM.md §13.1).
     */
    async overdueReviews(tenantId?: number): Promise<HrAlertRow[]> {
        const qb = this.cycles
            .createQueryBuilder('c')
            .innerJoin('c.employee', 'emp')
            .innerJoin(
                'employee_assignments',
                'cur',
                'cur.employee_id = emp.id AND cur.effective_to IS NULL',
            )
            .select([
                'c.id AS id',
                'c.due_date AS due_date',
                'c.cycle_type AS cycle_type',
                'emp.id AS employee_id',
                'emp.full_name AS employee_name',
                'emp.employee_code AS employee_code',
                'emp.tenant_id AS tenant_id',
                'cur.branch_id AS branch_id',
            ])
            .where("c.origin = 'system'")
            .andWhere("c.status IN ('scheduled', 'in_progress')")
            .andWhere('c.due_date < :today', { today: iso() });
        if (tenantId != null) {
            qb.andWhere('emp.tenant_id = :tenantId', { tenantId });
        }

        const rows = await qb.getRawMany<{
            id: number;
            due_date: string;
            cycle_type: string;
            employee_id: number;
            employee_name: string;
            employee_code: string;
            tenant_id: number;
            branch_id: number;
        }>();

        return rows.map((r) => ({
            kind: 'review_overdue' as const,
            dedupeKey: `hr.review_overdue:${r.id}`,
            tenantId: Number(r.tenant_id),
            branchId: Number(r.branch_id),
            employeeId: Number(r.employee_id),
            employeeName: r.employee_name,
            employeeCode: r.employee_code,
            date: r.due_date,
            label: r.employee_name,
            detail: `${r.cycle_type === 'probation_3m' ? 'Probation' : 'Quarterly'} review was due ${r.due_date}`,
            link: `/admin/hr/reviews/${r.id}`,
        }));
    }

    // ----------------------------------------------------------------- screen

    /** Everything, scoped to the caller, for the admin alerts screen. */
    async forUser(user: HrUser): Promise<{
        documents: HrAlertRow[];
        trainings: HrAlertRow[];
        probations: HrAlertRow[];
        reviews: HrAlertRow[];
    }> {
        const tenantId = user.tenantId ?? undefined;
        const [documents, trainings, probations, reviews] = await Promise.all([
            this.expiringDocuments(tenantId),
            this.expiringTrainings(tenantId),
            this.endingProbations(tenantId),
            this.overdueReviews(tenantId),
        ]);

        const inScope = (rows: HrAlertRow[]) =>
            user.allowedBranchIds == null
                ? rows
                : rows.filter((r) =>
                      user.allowedBranchIds!.includes(r.branchId),
                  );

        return {
            documents: inScope(documents),
            trainings: inScope(trainings),
            probations: inScope(probations),
            reviews: inScope(reviews),
        };
    }

    // ------------------------------------------------------------------ sweep

    /**
     * Reconcile every HR alert type against the notification store.
     *
     * Grouped by branch because that is how recipients resolve. Idempotent: a
     * second run the same day changes nothing, and a condition that cleared —
     * document renewed, review submitted — auto-resolves its notification.
     */
    async sweep(): Promise<{ opened: number; resolved: number }> {
        const groups: Array<{ type: string; rows: HrAlertRow[] }> = [
            {
                type: 'hr.document_expiring',
                rows: await this.expiringDocuments(),
            },
            {
                type: 'hr.training_expiring',
                rows: await this.expiringTrainings(),
            },
            {
                type: 'hr.probation_ending',
                rows: await this.endingProbations(),
            },
            { type: 'hr.review_overdue', rows: await this.overdueReviews() },
        ];

        let opened = 0;
        let resolved = 0;

        for (const group of groups) {
            // Every (tenant, branch) pair that has ever produced this alert must
            // be swept, not only the ones with rows today — a pair whose rows all
            // cleared is exactly the case that needs resolving.
            const scopes = new Map<
                string,
                { tenantId: number; branchId: number }
            >();
            for (const row of group.rows) {
                scopes.set(`${row.tenantId}:${row.branchId}`, {
                    tenantId: row.tenantId,
                    branchId: row.branchId,
                });
            }
            for (const scope of await this.notifications.openAlertScopes(
                group.type,
            )) {
                scopes.set(`${scope.tenantId}:${scope.branchId}`, scope);
            }

            for (const { tenantId, branchId } of scopes.values()) {
                const items: SystemAlertItem[] = group.rows
                    .filter(
                        (r) =>
                            r.tenantId === tenantId && r.branchId === branchId,
                    )
                    .map((r) => ({
                        dedupeKey: r.dedupeKey,
                        title: r.label,
                        body: r.detail,
                        data: {
                            employeeId: r.employeeId,
                            employeeCode: r.employeeCode,
                            date: r.date,
                            link: r.link,
                            branchId,
                        },
                    }));
                try {
                    const res = await this.notifications.syncSystemAlerts(
                        tenantId,
                        branchId,
                        group.type,
                        items,
                    );
                    opened += res.opened;
                    resolved += res.resolved;
                } catch (e) {
                    this.logger.error(
                        `${group.type} sweep failed for tenant ${tenantId} branch ${branchId}: ${String(e)}`,
                    );
                }
            }
        }

        return { opened, resolved };
    }
}
