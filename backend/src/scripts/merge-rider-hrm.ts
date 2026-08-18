/**
 * Fold rider PAY into the employee payroll engine (docs/HRM.md §12).
 *
 * Riders are paid a basic plus an amount per delivered order. Until now that
 * lived in its own module — `rider_profiles.base_salary` /
 * `default_per_ride_commission`, or a richer `rider_comp_plans` row — and was
 * paid by a separate payroll engine. The employee engine already understands
 * both concepts (`employee_salary_structures.basic_amount` and
 * `per_delivered_order_amount`, counted from delivered orders), so this script
 * moves the numbers across and nothing else.
 *
 * WHAT MOVES: pay. A rider gets an `employees` row (if they have none), a
 * `hire` assignment on a delivery designation, and one open salary structure.
 *
 * WHAT STAYS: dispatch. Rider profiles, availability, the assignment ledger,
 * break sessions, live locations and pool sharing are operations, not HR, and
 * are untouched.
 *
 * SAFETY (this is written to be run against production):
 *   - **Dry run by default.** Pass `--apply` to write.
 *   - **Deletes nothing, ever.** No rider profile, comp plan, payroll run,
 *     line or line item is modified or removed. Rider payroll history stays
 *     exactly where it is and stays readable.
 *   - Idempotent: a rider who already has an employee record is reused, and a
 *     rider who already has an open salary structure is left alone. Re-running
 *     after adding riders only adds the new ones.
 *   - One transaction: a failure leaves the database as it was.
 *   - Prints a per-rider plan first, including everyone it will SKIP and why,
 *     so nothing is moved silently.
 *
 *   npm run merge:rider-hrm             # dry run, prints the plan
 *   npm run merge:rider-hrm -- --apply  # writes
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

dotenvConfig({ path: join(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');

const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_DATABASE ?? 'foodies',
    namingStrategy: new SnakeNamingStrategy(),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
});

type Rider = {
    profileId: number;
    userId: number;
    tenantId: number;
    userName: string;
    phone: string | null;
    createdAt: Date;
    employeeCode: string | null;
    baseSalary: string | null;
    perRide: string | null;
    employmentStatus: string;
    isActive: boolean;
    employeeId: number | null;
    hasOpenSalary: boolean;
    branchId: number | null;
};

type PlanRow = Rider & {
    designationId: number | null;
    basic: number;
    perDeliveredOrder: number;
    source: 'comp_plan' | 'rider_profile';
    planName: string | null;
    skip: string | null;
};

const num = (v: string | number | null | undefined) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
};

async function main() {
    await dataSource.initialize();
    console.log(
        APPLY
            ? '\n=== MERGE RIDER HRM → EMPLOYEE PAYROLL — APPLYING ===\n'
            : '\n=== MERGE RIDER HRM → EMPLOYEE PAYROLL — DRY RUN (pass --apply to write) ===\n',
    );

    const riders: Rider[] = await dataSource.query(`
        SELECT rp.id                        AS "profileId",
               rp.user_id                   AS "userId",
               rp.tenant_id                 AS "tenantId",
               u.name                       AS "userName",
               u.phone                      AS "phone",
               rp.created_at                AS "createdAt",
               rp.employee_code             AS "employeeCode",
               rp.base_salary               AS "baseSalary",
               rp.default_per_ride_commission AS "perRide",
               rp.employment_status         AS "employmentStatus",
               rp.is_active                 AS "isActive",
               e.id                         AS "employeeId",
               EXISTS (
                   SELECT 1 FROM employee_salary_structures s
                    WHERE s.employee_id = e.id AND s.effective_to IS NULL
               )                            AS "hasOpenSalary",
               (SELECT bu.branch_id FROM branch_users bu
                 WHERE bu.user_id = rp.user_id
                 ORDER BY bu.branch_id ASC LIMIT 1) AS "branchId"
          FROM rider_profiles rp
          JOIN users u ON u.id = rp.user_id
     LEFT JOIN employees e ON e.user_id = rp.user_id
      ORDER BY rp.id
    `);

    if (riders.length === 0) {
        console.log('No rider profiles found — nothing to merge.\n');
        await dataSource.destroy();
        return;
    }

    // The richest source wins: an ACTIVE comp plan describes the rider's pay
    // more precisely than the profile's two columns, so it is preferred when
    // one exists.
    const plans: Array<{
        tenantId: number;
        branchId: number | null;
        name: string;
        componentKey: string;
        calcBasis: string;
        value: string;
    }> = await dataSource.query(`
        SELECT p.tenant_id AS "tenantId", p.branch_id AS "branchId", p.name AS "name",
               c.component_key AS "componentKey", c.calc_basis AS "calcBasis",
               c.value AS "value"
          FROM rider_comp_plans p
          JOIN rider_comp_plan_components c ON c.plan_id = p.id AND c.is_enabled = true
         WHERE p.status = 'active'
           AND (p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE)
    `);

    const designations: Array<{
        id: number;
        tenantId: number;
        slug: string;
        department: string;
    }> = await dataSource.query(
        `SELECT id, tenant_id AS "tenantId", slug, department FROM designations WHERE is_active = true`,
    );
    const riderDesignation = (tenantId: number): number | null =>
        designations.find((d) => d.tenantId === tenantId && d.slug === 'rider')
            ?.id ??
        designations.find(
            (d) => d.tenantId === tenantId && d.department === 'delivery',
        )?.id ??
        null;

    const plan: PlanRow[] = riders.map((r) => {
        const mine = plans.filter(
            (p) =>
                p.tenantId === r.tenantId &&
                (p.branchId == null || p.branchId === r.branchId),
        );
        const fromPlan = mine.length > 0;
        // `per_ride`-basis components are the delivery rate; everything else is
        // treated as part of the monthly basic.
        const basic = fromPlan
            ? mine
                  .filter((c) => c.calcBasis !== 'per_ride')
                  .reduce((s, c) => s + num(c.value), 0)
            : num(r.baseSalary);
        const perDeliveredOrder = fromPlan
            ? mine
                  .filter((c) => c.calcBasis === 'per_ride')
                  .reduce((s, c) => s + num(c.value), 0)
            : num(r.perRide);

        const designationId = riderDesignation(r.tenantId);
        let skip: string | null = null;
        if (r.hasOpenSalary) skip = 'already has an open salary structure';
        else if (!r.employeeId && designationId == null) {
            skip = 'tenant has no rider/delivery designation';
        } else if (!r.employeeId && r.branchId == null) {
            skip = 'rider is not assigned to any branch';
        } else if (basic === 0 && perDeliveredOrder === 0) {
            skip = 'no pay configured (base salary and per-ride are both zero)';
        }

        return {
            ...r,
            designationId,
            basic,
            perDeliveredOrder,
            source: fromPlan ? 'comp_plan' : 'rider_profile',
            planName: fromPlan ? mine[0].name : null,
            skip,
        };
    });

    const ready = plan.filter((p) => p.skip == null);
    const skipped = plan.filter((p) => p.skip != null);

    console.table(
        plan.map((p) => ({
            rider: p.userName,
            employee: p.employeeId ? `#${p.employeeId}` : 'will be created',
            branch: p.branchId ?? '—',
            basic: p.basic,
            'per order': p.perDeliveredOrder,
            source: p.source,
            action: p.skip ? `SKIP — ${p.skip}` : 'move pay',
        })),
    );

    console.log(
        `\n${ready.length} rider(s) to merge, ${skipped.length} skipped.\n` +
            'Rider profiles, comp plans and rider payroll history are NOT touched by this script.\n',
    );

    if (!APPLY) {
        console.log('Dry run only. Re-run with --apply to write.\n');
        await dataSource.destroy();
        return;
    }

    let employeesCreated = 0;
    let structuresCreated = 0;

    await dataSource.transaction(async (manager) => {
        for (const p of ready) {
            let employeeId = p.employeeId;

            if (!employeeId) {
                const [{ max }]: Array<{ max: string | null }> =
                    await manager.query(
                        `SELECT MAX(CAST(NULLIF(regexp_replace(employee_code, '\\D', '', 'g'), '') AS integer)) AS max
                       FROM employees WHERE tenant_id = $1`,
                        [p.tenantId],
                    );
                const code = `EMP-${String(Number(max ?? 0) + 1).padStart(4, '0')}`;
                const joining = (
                    p.createdAt instanceof Date
                        ? p.createdAt
                        : new Date(p.createdAt)
                )
                    .toISOString()
                    .slice(0, 10);

                const [employee]: Array<{ id: number }> = await manager.query(
                    `INSERT INTO employees
                        (tenant_id, employee_code, full_name, phone, user_id,
                         primary_branch_id, employment_type, date_of_joining,
                         status, payment_method)
                     VALUES ($1, $2, $3, $4, $5, $6, 'full_time', $7, $8, 'cash')
                     RETURNING id`,
                    [
                        p.tenantId,
                        code,
                        p.userName,
                        p.phone,
                        p.userId,
                        p.branchId,
                        joining,
                        // A rider who has left dispatch must not come back as an
                        // active employee.
                        p.isActive && p.employmentStatus !== 'terminated'
                            ? 'active'
                            : 'resigned',
                    ],
                );
                employeeId = employee.id;
                employeesCreated += 1;

                await manager.query(
                    `INSERT INTO employee_assignments
                        (tenant_id, employee_id, branch_id, brand_id, designation_id,
                         employment_type, effective_from, change_reason, note)
                     VALUES ($1, $2, $3, NULL, $4, 'full_time', $5, 'hire',
                             'Created by the rider HRM merge')`,
                    [
                        p.tenantId,
                        employeeId,
                        p.branchId,
                        p.designationId,
                        joining,
                    ],
                );

                await manager.query(
                    `INSERT INTO employee_events
                        (tenant_id, employee_id, event_type, event_date, title, description, payload)
                     VALUES ($1, $2, 'hired', CURRENT_DATE,
                             'Rider record migrated into HR',
                             'Pay moved from the rider module; dispatch history unchanged',
                             $3::jsonb)`,
                    [
                        p.tenantId,
                        employeeId,
                        JSON.stringify({ rider_profile_id: p.profileId }),
                    ],
                );
            }

            // Effective from the 1st of THIS month: back-dating into a closed
            // payroll period would change a payslip somebody has already been
            // paid against.
            const [structure]: Array<{ id: number }> = await manager.query(
                `INSERT INTO employee_salary_structures
                    (tenant_id, employee_id, effective_from, pay_type, basic_amount,
                     currency, daily_rate_basis, per_delivered_order_amount, change_reason)
                 VALUES ($1, $2, date_trunc('month', CURRENT_DATE)::date, 'monthly',
                         $3, 'PKR', 'fixed_30', $4, 'rider_hrm_merge')
                 RETURNING id`,
                [p.tenantId, employeeId, p.basic, p.perDeliveredOrder],
            );
            structuresCreated += 1;

            await manager.query(
                `INSERT INTO employee_events
                    (tenant_id, employee_id, event_type, event_date, title, description, payload)
                 VALUES ($1, $2, 'salary_changed', CURRENT_DATE,
                         'Rider pay moved into HR payroll',
                         $3, $4::jsonb)`,
                [
                    p.tenantId,
                    employeeId,
                    `Basic ${p.basic}, ${p.perDeliveredOrder} per delivered order (from ${p.source})`,
                    JSON.stringify({
                        structure_id: structure.id,
                        source: p.source,
                        plan_name: p.planName,
                        rider_profile_id: p.profileId,
                    }),
                ],
            );
        }
    });

    console.log(
        `Done. ${employeesCreated} employee record(s) created, ` +
            `${structuresCreated} salary structure(s) opened.\n` +
            'Next: check HR → Employees, then run payroll for the period.\n',
    );
    await dataSource.destroy();
}

main().catch((err) => {
    console.error('Merge failed — nothing was written:', err);
    process.exit(1);
});
