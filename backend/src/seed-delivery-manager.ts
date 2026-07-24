/**
 * Seed: the "Delivery Manager" role + the Pine Avenue delivery manager user for
 * the Foodies tenant.
 *
 * A delivery manager gets a single, read-only permission — `rider-supervisor:view`
 * — which unlocks the Rider Supervisor sub-module under Rider HRM (recent
 * delivery orders, the live rider roster with attendance, and base salary).
 * They can EDIT nothing: salary edits and user creation stay on the admin side.
 *
 * Scoping follows the standard model:
 *  - branch_users row on the branch with brand_id NULL ⇒ all brands, that
 *    branch only (Pine Avenue). No all-branches:access, so they are clamped to
 *    Pine Avenue; brand-unlocked, so they see every brand at that branch.
 *
 * The role's permission set is fully editable afterwards from the Roles admin
 * UI — this seeder only bootstraps it.
 *
 * Idempotent: safe to re-run. An existing user is re-pointed at the right role,
 * branch and brand rather than duplicated. Run: npm run seed:delivery-manager
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { User } from './entities/user.entity';
import { TenantUser } from './entities/tenant-user.entity';
import { BranchUser } from './entities/branch-user.entity';
import { Branch } from './entities/branch.entity';
import { Role } from './entities/role.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

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
    entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
});

/** Tenant is resolved from this account, exactly as the other seeders do. */
const OWNER_EMAIL = 'foodies@demo.com';

/**
 * The branch the delivery manager oversees. The demo tenant has no literal
 * "Pine Avenue" branch, so we fall back to the same branch the existing
 * "Branch Manager Pine Avenue" seeder (seed-client-users) uses. Point
 * BRANCH_NAME at a real branch name in production.
 */
const BRANCH_NAME = 'Pine Avenue';
const FALLBACK_BRANCH_NAME = 'Emporium';

/** Distinct slug so this never mutates any demo role. */
const DELIVERY_MANAGER_ROLE = {
    name: 'Delivery Manager',
    slug: 'delivery_manager',
};

/** The one read-only permission that unlocks the Rider Supervisor sub-module. */
const DELIVERY_MANAGER_PERMISSIONS = ['rider-supervisor:view'];

/** Aligns with the 30-day window the supervisor view already enforces. */
const DELIVERY_MANAGER_HISTORY_DAYS = 30;

const DELIVERY_MANAGER = {
    name: 'Delivery Manager Pine Avenue',
    email: 'dmpine@foodies.com',
    password: 'dMfOodies@P',
    /** null = every brand at the branch (not brand-locked). */
    brand: null as string | null,
};

/** The permission row this role needs — kept in step with the migration so the
 *  seeder is self-sufficient even against a DB whose migrations have not run. */
const RIDER_SUPERVISOR_PERMISSION = {
    name: 'rider-supervisor:view',
    resource: 'rider-supervisor',
    action: 'view',
    description:
        'View the read-only rider supervisor dashboard (recent delivery orders, rider roster, attendance and base salary)',
};

async function seed() {
    await dataSource.initialize();
    const userRepo = dataSource.getRepository(User);
    const tenantUserRepo = dataSource.getRepository(TenantUser);
    const branchUserRepo = dataSource.getRepository(BranchUser);
    const branchRepo = dataSource.getRepository(Branch);
    const roleRepo = dataSource.getRepository(Role);

    // —— Tenant ——
    const owner = await userRepo.findOne({ where: { email: OWNER_EMAIL } });
    if (!owner) throw new Error(`Owner user ${OWNER_EMAIL} not found`);
    const ownerTenantUser = await tenantUserRepo.findOne({
        where: { userId: owner.id },
    });
    if (!ownerTenantUser)
        throw new Error(`${OWNER_EMAIL} has no tenant_users row`);
    const tenantId = ownerTenantUser.tenantId;
    console.log(`Tenant of ${OWNER_EMAIL}: ${tenantId}`);

    // —— Branch (fall back to the shared demo branch if Pine Avenue is absent) ——
    let branch = await branchRepo.findOne({ where: { name: BRANCH_NAME } });
    if (!branch) {
        branch = await branchRepo.findOne({
            where: { name: FALLBACK_BRANCH_NAME },
        });
        if (branch)
            console.log(
                `Branch "${BRANCH_NAME}" not found — using "${FALLBACK_BRANCH_NAME}" (id ${branch.id})`,
            );
    }
    if (!branch)
        throw new Error(
            `Neither "${BRANCH_NAME}" nor "${FALLBACK_BRANCH_NAME}" found — create the branch or change BRANCH_NAME`,
        );
    console.log(`Branch "${branch.name}": ${branch.id}`);

    // —— Permission (defensive; migration normally inserts it on app boot) ——
    await dataSource.query(
        `INSERT INTO permissions (name, resource, action, description)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO NOTHING`,
        [
            RIDER_SUPERVISOR_PERMISSION.name,
            RIDER_SUPERVISOR_PERMISSION.resource,
            RIDER_SUPERVISOR_PERMISSION.action,
            RIDER_SUPERVISOR_PERMISSION.description,
        ],
    );

    // —— Role: find-or-create, then sync to exactly this permission set ——
    let role = await roleRepo.findOne({
        where: { slug: DELIVERY_MANAGER_ROLE.slug },
    });
    if (!role) {
        role = await roleRepo.save(
            roleRepo.create({
                tenantId,
                name: DELIVERY_MANAGER_ROLE.name,
                slug: DELIVERY_MANAGER_ROLE.slug,
                orderHistoryDays: DELIVERY_MANAGER_HISTORY_DAYS,
            }),
        );
        console.log(
            `Created role "${DELIVERY_MANAGER_ROLE.name}" (id ${role.id})`,
        );
    } else {
        role.orderHistoryDays = DELIVERY_MANAGER_HISTORY_DAYS;
        await roleRepo.save(role);
        console.log(
            `Role "${DELIVERY_MANAGER_ROLE.name}" already exists (id ${role.id})`,
        );
    }
    // Add what's missing, drop anything extra, so a re-run repairs a hand-edited
    // role instead of silently widening it.
    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.name = ANY($2::text[])
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = $1 AND rp.permission_id = p.id
           )`,
        [role.id, DELIVERY_MANAGER_PERMISSIONS],
    );
    await dataSource.query(
        `DELETE FROM role_permissions rp
         USING permissions p
         WHERE rp.permission_id = p.id
           AND rp.role_id = $1
           AND NOT (p.name = ANY($2::text[]))`,
        [role.id, DELIVERY_MANAGER_PERMISSIONS],
    );
    console.log(
        `  permissions synced: ${DELIVERY_MANAGER_PERMISSIONS.join(', ')}`,
    );

    // —— User: create if new, always (re)point the tenant row (role on branch) ——
    let user = await userRepo.findOne({
        where: { email: DELIVERY_MANAGER.email },
    });
    if (!user) {
        user = await userRepo.save(
            userRepo.create({
                name: DELIVERY_MANAGER.name,
                email: DELIVERY_MANAGER.email,
                password: await bcrypt.hash(DELIVERY_MANAGER.password, 10),
                status: 'active',
            }),
        );
        console.log(`Created user ${DELIVERY_MANAGER.email} (id ${user.id})`);
    } else {
        console.log(
            `User ${DELIVERY_MANAGER.email} already exists (id ${user.id})`,
        );
    }
    const tu = await tenantUserRepo.findOne({
        where: { userId: user.id, tenantId },
    });
    if (tu) {
        tu.roleId = null;
        await tenantUserRepo.save(tu);
    } else {
        await tenantUserRepo.save(
            tenantUserRepo.create({ tenantId, userId: user.id, roleId: null }),
        );
    }

    // —— Branch assignment: Pine Avenue, every brand (brand_id NULL) ——
    const existing = await branchUserRepo.findOne({
        where: { branchId: branch.id, userId: user.id },
    });
    if (existing) {
        existing.roleId = role.id;
        existing.brandId = null;
        await branchUserRepo.save(existing);
    } else {
        await branchUserRepo.save(
            branchUserRepo.create({
                branchId: branch.id,
                userId: user.id,
                roleId: role.id,
                brandId: null,
            }),
        );
    }
    console.log(`  ${DELIVERY_MANAGER.email} → ${BRANCH_NAME} / all brands`);

    console.log('\nAccount created (email / password):');
    console.log(
        `  ${DELIVERY_MANAGER.email.padEnd(26)} ${DELIVERY_MANAGER.password}`,
    );
    await dataSource.destroy();
}

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
