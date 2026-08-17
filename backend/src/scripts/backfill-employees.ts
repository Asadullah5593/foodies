/**
 * Create employee records for staff who already have a system login.
 *
 * Reads `branch_users` (the user ↔ branch ↔ role ↔ brand assignment) and
 * creates a linked `employees` row plus a `hire` assignment for anyone not
 * already linked. Saves double entry and — more importantly — guarantees the
 * user↔employee link is correct, which is what ties a POS shift to the person
 * standing at it.
 *
 * SAFETY (this runs against a live database):
 *   - **Dry run by default.** Pass `--apply` to actually write.
 *   - Idempotent: a user already linked to an employee is skipped, so it can be
 *     re-run after adding staff.
 *   - Never touches existing employees, users, roles or branch_users rows.
 *   - Wraps writes in one transaction — a failure leaves nothing behind.
 *
 * `date_of_joining` is a PLACEHOLDER (the user account's creation date, which
 * is the best available proxy) and every created record is left on
 * `employment_type = 'full_time'`. HR must review and correct both before
 * payroll runs — nobody is paid off this data.
 *
 *   npm run backfill:employees            # dry run, prints the plan
 *   npm run backfill:employees -- --apply # writes
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

/**
 * Role slug → designation slug. Covers every naming variant seen across
 * environments (seed `branch_manager`, live `branchmanager`, this project's
 * `pos_*` family). Anything unmatched falls back to the designation named
 * below, so an unknown role never silently skips a person.
 */
const ROLE_TO_DESIGNATION: Record<string, string> = {
    owner: 'branch-manager',
    general_manager: 'branch-manager',
    manager: 'branch-manager',
    branch_manager: 'branch-manager',
    branchmanager: 'branch-manager',
    pos_branch_manager: 'branch-manager',
    brand_admin: 'branch-manager',
    brandadmin: 'branch-manager',
    shift_manager: 'shift-supervisor',
    pos_shift_manager_tab: 'shift-supervisor',
    cashier: 'cashier',
    pos_cashier: 'cashier',
    call_centre_agent: 'cashier',
    call_center_agent: 'cashier',
    rider: 'rider',
    delivery_manager: 'shift-supervisor',
};
const FALLBACK_DESIGNATION = 'kitchen-helper';

type Candidate = {
    userId: number;
    userName: string;
    email: string | null;
    phone: string | null;
    createdAt: Date;
    branchId: number;
    brandId: number | null;
    roleSlug: string;
    tenantId: number;
};

async function main() {
    await dataSource.initialize();
    console.log(
        APPLY
            ? '\n=== BACKFILL EMPLOYEES — APPLYING ===\n'
            : '\n=== BACKFILL EMPLOYEES — DRY RUN (pass --apply to write) ===\n',
    );

    // One branch_users row per user: the lowest branch id, so a multi-branch
    // user gets exactly one employee record rather than one per branch.
    const candidates: Candidate[] = await dataSource.query(`
        SELECT DISTINCT ON (bu.user_id)
            bu.user_id       AS "userId",
            u.name           AS "userName",
            u.email          AS "email",
            u.phone          AS "phone",
            u.created_at     AS "createdAt",
            bu.branch_id     AS "branchId",
            bu.brand_id      AS "brandId",
            r.slug           AS "roleSlug",
            tu.tenant_id     AS "tenantId"
        FROM branch_users bu
        JOIN users u        ON u.id = bu.user_id
        JOIN roles r        ON r.id = bu.role_id
        JOIN tenant_users tu ON tu.user_id = bu.user_id
        WHERE NOT EXISTS (
            SELECT 1 FROM employees e WHERE e.user_id = bu.user_id
        )
        ORDER BY bu.user_id, bu.branch_id ASC
    `);

    if (candidates.length === 0) {
        console.log('Nothing to do — every branch user already has an employee record.\n');
        await dataSource.destroy();
        return;
    }

    const designations: Array<{ id: number; slug: string; tenantId: number }> =
        await dataSource.query(
            `SELECT id, slug, tenant_id AS "tenantId" FROM designations`,
        );
    const designationFor = (tenantId: number, roleSlug: string): number | null => {
        const wanted = ROLE_TO_DESIGNATION[roleSlug] ?? FALLBACK_DESIGNATION;
        const exact = designations.find(
            (d) => d.tenantId === tenantId && d.slug === wanted,
        );
        if (exact) return exact.id;
        const fallback = designations.find(
            (d) => d.tenantId === tenantId && d.slug === FALLBACK_DESIGNATION,
        );
        return fallback?.id ?? null;
    };

    const plan = candidates.map((c) => ({
        ...c,
        designationId: designationFor(c.tenantId, c.roleSlug),
        joiningDate: (c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt))
            .toISOString()
            .slice(0, 10),
        mappedFrom: ROLE_TO_DESIGNATION[c.roleSlug] ? c.roleSlug : `${c.roleSlug} (unmapped)`,
    }));

    const blocked = plan.filter((p) => p.designationId == null);
    const ready = plan.filter((p) => p.designationId != null);

    console.table(
        ready.map((p) => ({
            user: p.userName,
            email: p.email ?? '—',
            role: p.mappedFrom,
            branch: p.branchId,
            brand: p.brandId ?? 'shared',
            joining: p.joiningDate,
        })),
    );

    if (blocked.length > 0) {
        console.warn(
            `\n⚠️  ${blocked.length} user(s) skipped — their tenant has no designations seeded:`,
        );
        for (const b of blocked) console.warn(`   - ${b.userName} (tenant ${b.tenantId})`);
    }

    if (!APPLY) {
        console.log(
            `\nDry run only. ${ready.length} employee record(s) would be created. Re-run with --apply to write.\n`,
        );
        await dataSource.destroy();
        return;
    }

    let created = 0;
    await dataSource.transaction(async (manager) => {
        for (const p of ready) {
            // Per-tenant sequential code, computed inside the transaction and
            // backed by the (tenant_id, employee_code) unique constraint.
            const [{ max }]: Array<{ max: string | null }> = await manager.query(
                `SELECT MAX(CAST(NULLIF(regexp_replace(employee_code, '\\D', '', 'g'), '') AS integer)) AS max
                 FROM employees WHERE tenant_id = $1`,
                [p.tenantId],
            );
            const code = `EMP-${String(Number(max ?? 0) + 1).padStart(4, '0')}`;

            const [employee]: Array<{ id: number }> = await manager.query(
                `INSERT INTO employees
                    (tenant_id, employee_code, full_name, phone, user_id,
                     primary_branch_id, employment_type, date_of_joining, status, payment_method)
                 VALUES ($1, $2, $3, $4, $5, $6, 'full_time', $7, 'active', 'cash')
                 RETURNING id`,
                [
                    p.tenantId,
                    code,
                    p.userName,
                    p.phone,
                    p.userId,
                    p.branchId,
                    p.joiningDate,
                ],
            );

            await manager.query(
                `INSERT INTO employee_assignments
                    (tenant_id, employee_id, branch_id, brand_id, designation_id,
                     employment_type, effective_from, change_reason, note)
                 VALUES ($1, $2, $3, $4, $5, 'full_time', $6, 'hire', $7)`,
                [
                    p.tenantId,
                    employee.id,
                    p.branchId,
                    p.brandId,
                    p.designationId,
                    p.joiningDate,
                    `Backfilled from branch_users (role: ${p.roleSlug}). Joining date is a placeholder — confirm with HR.`,
                ],
            );

            await manager.query(
                `INSERT INTO employee_events
                    (tenant_id, employee_id, event_type, event_date, title, description, ref_table, ref_id, payload)
                 VALUES ($1, $2, 'hired', $3, $4, $5, 'employees', $6, $7)`,
                [
                    p.tenantId,
                    employee.id,
                    p.joiningDate,
                    'Record created from existing login',
                    'Backfilled when Employee HRM was introduced. Joining date and employment type need HR review.',
                    employee.id,
                    JSON.stringify({ backfilled: true, role_slug: p.roleSlug }),
                ],
            );
            created += 1;
        }
    });

    console.log(`\n✅ Created ${created} employee record(s).`);
    console.log(
        '   Joining dates and employment types are PLACEHOLDERS — have HR review them before payroll.\n',
    );
    await dataSource.destroy();
}

main().catch(async (err) => {
    console.error('Backfill failed:', err);
    if (dataSource.isInitialized) await dataSource.destroy();
    process.exit(1);
});
