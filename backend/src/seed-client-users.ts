/**
 * Seed: the client's operational staff — cashiers, call-centre agents, a branch
 * manager and an admin — for the Foodies tenant.
 *
 * Three new roles are created (existing demo roles are left untouched):
 *
 *  - Cashier            POS + own-brand order history, 7-day window, no filters
 *  - Call Centre Agent  POS + order history across every branch/brand, 30-day
 *  - Branch Manager     the above for one branch + full inventory, 30-day
 *
 * "Only date filters in order history" is expressed by granting NO
 * `orders:filter:*` permission — the date range is always available, every other
 * control is hidden. The history window is `roles.order_history_days`, enforced
 * server-side (see docs/SYSTEM_FUNCTIONALITIES_AND_FLOW.md).
 *
 * Scoping follows the standard model:
 *  - brand cashiers  → branch_users row on BRANCH_NAME with brand_id set
 *                      (brand-locked: they only ever see their own brand)
 *  - call centre     → tenant_users role only, no branch_users rows, and
 *                      all-branches:access ⇒ every branch, every brand
 *  - branch manager  → branch_users row with brand_id NULL ⇒ all brands, that
 *                      branch only
 *  - admin           → the existing `owner` role (everything, all branches)
 *
 * Idempotent: safe to re-run. Existing users are re-pointed at the right role,
 * branch and brand rather than duplicated. Run: npm run seed:client-users
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
import { Brand } from './entities/brand.entity';
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

/** The branch every cashier and the branch manager work at. */
const BRANCH_NAME = 'Emporium';

/**
 * Role names/slugs. The slugs are deliberately distinct from the demo roles
 * (`cashier`, `branchmanager`) so this seeder never mutates those; rename here
 * if you want different labels in the Roles screen.
 */
const CASHIER_ROLE = { name: 'Cashier', slug: 'pos_cashier' };
const CALL_CENTRE_ROLE = { name: 'Call Centre Agent', slug: 'call_centre_agent' };
const BRANCH_MANAGER_ROLE = { name: 'Branch Manager', slug: 'pos_branch_manager' };

/** Days of order history each role may read (null would mean unlimited). */
const CASHIER_HISTORY_DAYS = 7;
const CALL_CENTRE_HISTORY_DAYS = 30;
const BRANCH_MANAGER_HISTORY_DAYS = 30;

/**
 * Run the POS (all three order types — dine-in, takeaway and delivery are not
 * separately permissioned) and read order history. Opening/closing the shift is
 * required or the POS has no till to sell against. No `dashboard:view`, so these
 * users land straight on the POS after login. No `orders:filter:*`, so order
 * history offers the date range only.
 */
const CASHIER_PERMISSIONS = [
    'orders:create',
    'orders:view',
    'shifts:open',
    'shifts:close',
];

/**
 * As the cashier, plus every branch, with brand unrestricted (no branch_users
 * rows). Deliberately NOT shifts:open — the server only lets brand-locked staff
 * open a till ("Shifts are opened by brand staff", shifts.service create()), so
 * an all-brands agent could never use it. They sell against the shift the
 * brand's cashier opened; shifts:view lets them see whether a till is open.
 */
const CALL_CENTRE_PERMISSIONS = [
    'orders:create',
    'orders:view',
    'shifts:view',
    'all-branches:access',
];

/**
 * One branch, every brand on it. Adds the brand filter in order history (the
 * only filter requested) and full inventory operations. Shifts are view+close
 * only, mirroring the server rule that an unrestricted (non brand-locked)
 * account may oversee and close a till but not open one.
 */
const BRANCH_MANAGER_PERMISSIONS = [
    'orders:create',
    'orders:view',
    'orders:filter:brand',
    'shifts:view',
    'shifts:close',
    // Full inventory operations at their branch.
    'inventory:view',
    'inventory:receive',
    'inventory:adjust',
    'inventory:waste',
    'inventory:stocktake',
    'inventory:transfer',
    'inventory:transfer:request',
    'inventory:transfer:approve',
    // Inventory master data.
    'inventory-items:view',
    'inventory-items:create',
    'inventory-items:edit',
    'inventory-items:delete',
    'uoms:view',
    'uoms:create',
    'uoms:edit',
    'uoms:delete',
    'vendors:view',
    'vendors:create',
    'vendors:edit',
    'vendors:delete',
];

type Staff = {
    name: string;
    email: string;
    password: string;
    /** Exact brand name to lock this user to; null = every brand. */
    brand: string | null;
};

/** Brand-locked cashiers. Brand names must match `brands.name` exactly. */
const CASHIERS: Staff[] = [
    // Morning shift
    { name: 'Loranzo Cashier 1', email: 'cashier1@loranzo.com', password: 'LorAnzoCashOne', brand: 'Loranzo' },
    { name: 'Wok&Go Cashier 1', email: 'cashier1@wokndgo.com', password: 'WoKCaSh01', brand: 'Wok & Go' },
    { name: 'PepriCo Cashier 1', email: 'cashier1@peprico.com', password: 'PepRiCo@1', brand: 'Peperi. Co' },
    { name: 'Fireaway Cashier 1', email: 'cashier1@fireaway.com', password: 'FiR@1', brand: 'Fireaway' },
    // Evening shift
    { name: 'Loranzo Cashier 2', email: 'cashier2@loranzo.com', password: 'LorAnzoCashTwo', brand: 'Loranzo' },
    { name: 'Wok&Go Cashier 2', email: 'cashier2@wokndgo.com', password: 'WoKCaSh02', brand: 'Wok & Go' },
    { name: 'PepriCo Cashier 2', email: 'cashier2@peprico.com', password: 'PepRiCo@2', brand: 'Peperi. Co' },
    { name: 'Fireaway Cashier 2', email: 'cashier2@fireaway.com', password: 'FiR@2', brand: 'Fireaway' },
];

/** All branches, all brands — no branch_users rows at all. */
const CALL_CENTRE_AGENTS: Staff[] = [
    { name: 'Hira Call Center Agent 1', email: 'hiracall1@foodies.com', password: 'CorE@1', brand: null },
    { name: 'Aqsa Call Center Agent 2', email: 'aqsacall2@foodies.com', password: 'CoRe@2', brand: null },
    { name: 'Sadia Call Center Agent 3', email: 'sadiacall3@foodies.com', password: 'COre@3', brand: null },
];

/** One branch, every brand on it. */
const BRANCH_MANAGER: Staff = {
    name: 'Branch Manager Pine Avenue',
    email: 'bmpine@foodies.com',
    password: 'BmFooDies@P',
    brand: null,
};

/** Everything, via the existing `owner` role. */
const ADMIN: Staff = {
    name: 'Admin',
    email: 'admin@foodies.com',
    password: 'AdMiN@051@',
    brand: null,
};

async function seed() {
    await dataSource.initialize();
    const userRepo = dataSource.getRepository(User);
    const tenantUserRepo = dataSource.getRepository(TenantUser);
    const branchUserRepo = dataSource.getRepository(BranchUser);
    const branchRepo = dataSource.getRepository(Branch);
    const brandRepo = dataSource.getRepository(Brand);
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

    // —— Branch ——
    const branch = await branchRepo.findOne({ where: { name: BRANCH_NAME } });
    if (!branch)
        throw new Error(
            `Branch "${BRANCH_NAME}" not found — create it first, or change BRANCH_NAME`,
        );
    console.log(`Branch "${BRANCH_NAME}": ${branch.id}`);

    // —— Brands (exact name match; fail loudly rather than mis-assign) ——
    const brands = await brandRepo.find({ where: { tenantId } });
    const brandByName = new Map(brands.map((b) => [b.name, b]));
    const requiredBrands = [
        ...new Set(CASHIERS.map((c) => c.brand).filter((b): b is string => !!b)),
    ];
    const missing = requiredBrands.filter((n) => !brandByName.has(n));
    if (missing.length) {
        throw new Error(
            `Brand(s) not found in tenant ${tenantId}: ${missing.join(', ')}. ` +
                `Available: ${brands.map((b) => b.name).join(', ')}`,
        );
    }

    /** Find-or-create a role, then sync its permissions and history window. */
    const upsertRole = async (
        def: { name: string; slug: string },
        permissions: string[],
        historyDays: number | null,
    ): Promise<Role> => {
        let role = await roleRepo.findOne({ where: { slug: def.slug } });
        if (!role) {
            role = await roleRepo.save(
                roleRepo.create({
                    tenantId,
                    name: def.name,
                    slug: def.slug,
                    orderHistoryDays: historyDays,
                }),
            );
            console.log(`Created role "${def.name}" (id ${role.id})`);
        } else {
            role.orderHistoryDays = historyDays;
            await roleRepo.save(role);
            console.log(`Role "${def.name}" already exists (id ${role.id})`);
        }
        // Grant exactly this set: add what's missing, drop anything extra, so a
        // re-run repairs a hand-edited role instead of silently widening it.
        await dataSource.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT $1, p.id FROM permissions p
             WHERE p.name = ANY($2::text[])
               AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = $1 AND rp.permission_id = p.id
               )`,
            [role.id, permissions],
        );
        await dataSource.query(
            `DELETE FROM role_permissions rp
             USING permissions p
             WHERE rp.permission_id = p.id
               AND rp.role_id = $1
               AND NOT (p.name = ANY($2::text[]))`,
            [role.id, permissions],
        );
        const [{ count }] = (await dataSource.query(
            `SELECT count(*)::int AS count FROM role_permissions WHERE role_id = $1`,
            [role.id],
        )) as { count: number }[];
        console.log(
            `  permissions synced: ${count}` +
                `, order history: ${historyDays ?? 'unlimited'} day(s)`,
        );
        return role;
    };

    const cashierRole = await upsertRole(
        CASHIER_ROLE,
        CASHIER_PERMISSIONS,
        CASHIER_HISTORY_DAYS,
    );
    const callCentreRole = await upsertRole(
        CALL_CENTRE_ROLE,
        CALL_CENTRE_PERMISSIONS,
        CALL_CENTRE_HISTORY_DAYS,
    );
    const branchManagerRole = await upsertRole(
        BRANCH_MANAGER_ROLE,
        BRANCH_MANAGER_PERMISSIONS,
        BRANCH_MANAGER_HISTORY_DAYS,
    );

    const ownerRole = await roleRepo.findOne({ where: { slug: 'owner' } });
    if (!ownerRole) throw new Error('Role "owner" not found');

    /** Create the user if new, always (re)point their tenant row. */
    const upsertUser = async (staff: Staff, tenantRoleId: number | null) => {
        let user = await userRepo.findOne({ where: { email: staff.email } });
        if (!user) {
            user = await userRepo.save(
                userRepo.create({
                    name: staff.name,
                    email: staff.email,
                    password: await bcrypt.hash(staff.password, 10),
                    status: 'active',
                }),
            );
            console.log(`Created user ${staff.email} (id ${user.id})`);
        } else {
            console.log(`User ${staff.email} already exists (id ${user.id})`);
        }
        const tu = await tenantUserRepo.findOne({
            where: { userId: user.id, tenantId },
        });
        if (tu) {
            tu.roleId = tenantRoleId;
            await tenantUserRepo.save(tu);
        } else {
            await tenantUserRepo.save(
                tenantUserRepo.create({
                    tenantId,
                    userId: user.id,
                    roleId: tenantRoleId,
                }),
            );
        }
        return user;
    };

    /** Put the user on the branch with the given role, locked to a brand or not. */
    const assignToBranch = async (
        userId: number,
        roleId: number,
        brandId: number | null,
    ) => {
        const existing = await branchUserRepo.findOne({
            where: { branchId: branch.id, userId },
        });
        if (existing) {
            existing.roleId = roleId;
            existing.brandId = brandId;
            await branchUserRepo.save(existing);
        } else {
            await branchUserRepo.save(
                branchUserRepo.create({
                    branchId: branch.id,
                    userId,
                    roleId,
                    brandId,
                }),
            );
        }
    };

    // —— Admin: everything, all branches, all brands ——
    console.log('\n— Admin —');
    await upsertUser(ADMIN, ownerRole.id);
    console.log(`  ${ADMIN.email} → owner role (all branches, all brands)`);

    // —— Brand cashiers: one branch, locked to their brand ——
    console.log('\n— Cashiers —');
    for (const staff of CASHIERS) {
        const brand = brandByName.get(staff.brand as string)!;
        const user = await upsertUser(staff, null);
        await assignToBranch(user.id, cashierRole.id, brand.id);
        console.log(
            `  ${staff.email} → ${BRANCH_NAME} / ${brand.name} (brand-locked)`,
        );
    }

    // —— Call centre: every branch, every brand (no branch_users rows) ——
    console.log('\n— Call centre —');
    for (const staff of CALL_CENTRE_AGENTS) {
        const user = await upsertUser(staff, callCentreRole.id);
        // Remove any stale branch row: a branch_users row would re-scope them.
        await branchUserRepo.delete({ userId: user.id });
        console.log(`  ${staff.email} → all branches, all brands`);
    }

    // —— Branch manager: one branch, every brand on it ——
    console.log('\n— Branch manager —');
    const bm = await upsertUser(BRANCH_MANAGER, null);
    await assignToBranch(bm.id, branchManagerRole.id, null);
    console.log(`  ${BRANCH_MANAGER.email} → ${BRANCH_NAME} / all brands`);

    console.log('\nAccounts created (email / password):');
    for (const s of [ADMIN, ...CASHIERS, ...CALL_CENTRE_AGENTS, BRANCH_MANAGER]) {
        console.log(`  ${s.email.padEnd(26)} ${s.password}`);
    }
    await dataSource.destroy();
}

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
