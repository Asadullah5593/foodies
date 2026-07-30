/**
 * Seed: the client's four Pine Avenue shift-manager tablets.
 *
 * These are order-taking tablets on the shop floor, not administrators. All
 * four share ONE role — the A/B/C/D distinction is which tablet, and it lives
 * in the username, so a permission change lands on every tablet at once.
 *
 * Deliberately a separate seeder from seed-client-users.ts: it must never
 * touch that script's roles or accounts. It creates exactly one new role and
 * four new users, and writes nothing else.
 *
 * No new permission was needed — the four capabilities the client asked for map
 * onto permissions that already exist:
 *
 *   "use the POS and take orders"      → orders:create
 *   "view orders of the last two days" → orders:view + roles.order_history_days = 2
 *   "view the statuses of orders"      → orders:view (the Orders list shows the
 *                                        kitchen status; CHANGING it would need
 *                                        orders:update-status, not requested)
 *   "order from all brands"            → branch_users.brand_id = NULL, i.e. not
 *                                        brand-locked, on this one branch
 *
 * No shift permission by the client's decision: an all-brands account cannot
 * open a till anyway (the server only lets brand-locked staff do that), and the
 * POS already reports a brand whose shift is closed while still allowing items
 * from brands whose shift is open.
 *
 * No dashboard:view either, so these accounts land straight on the POS.
 * No orders:filter:* — order history offers the date range only.
 *
 * Idempotent: safe to re-run. An existing user is re-pointed at the right role,
 * branch and brand rather than duplicated, and the role's permission set is
 * repaired to exactly the list below. Run: npm run seed:shift-managers
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
 * The branch the client calls "Pine Avenue". There is no branch by that name —
 * it is Emporium in the data, which is where every other Pine Avenue account
 * already sits (see seed-client-users.ts).
 */
const BRANCH_NAME = 'Emporium';

/**
 * One shared role. The slug is distinct from every existing role so this
 * seeder can never mutate the demo roles (`cashier`, `branchmanager`) or the
 * client roles from seed-client-users.ts (`pos_cashier`, `call_centre_agent`,
 * `pos_branch_manager`).
 */
const SHIFT_MANAGER_ROLE = {
    name: 'Shift Manager Tab',
    slug: 'pos_shift_manager_tab',
};

/** "View orders of the last two days." Enforced server-side. */
const SHIFT_MANAGER_HISTORY_DAYS = 2;

const SHIFT_MANAGER_PERMISSIONS = ['orders:create', 'orders:view'];

type Staff = { name: string; email: string; password: string };

/** The four tablets. All identical in rights; the letter is the device. */
const SHIFT_MANAGERS: Staff[] = [
    {
        name: 'Shift Manager A Pine Avenue',
        email: 'shiftmapine@foodies.com',
        password: 'SHiftMa@P',
    },
    {
        name: 'Shift Manager B Pine Avenue',
        email: 'shiftmbpine@foodies.com',
        password: 'shiFtmB@P',
    },
    {
        name: 'Shift Manager C Pine Avenue',
        email: 'shiftmcpine@foodies.com',
        password: 'SHiftMC@P',
    },
    {
        name: 'Shift Manager D Pine Avenue',
        email: 'shiftmdpine@foodies.com',
        password: 'SHiftmD@P',
    },
];

async function seed() {
    await dataSource.initialize();
    const userRepo = dataSource.getRepository(User);
    const tenantUserRepo = dataSource.getRepository(TenantUser);
    const branchUserRepo = dataSource.getRepository(BranchUser);
    const branchRepo = dataSource.getRepository(Branch);
    const roleRepo = dataSource.getRepository(Role);

    const owner = await userRepo.findOne({ where: { email: OWNER_EMAIL } });
    if (!owner) throw new Error(`Owner account ${OWNER_EMAIL} not found`);
    const ownerTenant = await tenantUserRepo.findOne({
        where: { userId: owner.id },
    });
    if (!ownerTenant) throw new Error(`No tenant row for ${OWNER_EMAIL}`);
    const tenantId = ownerTenant.tenantId;
    console.log(`Tenant ${tenantId} (resolved from ${OWNER_EMAIL})`);

    // Branch names repeat across tenants, so scope the lookup by the brands
    // that hang off it — picking another tenant's "Emporium" would place these
    // tablets on someone else's till.
    const rows = (await dataSource.query(
        `SELECT DISTINCT b.id, b.name
           FROM branches b
           JOIN branch_brands bb ON bb.branch_id = b.id
           JOIN brands br ON br.id = bb.brand_id
          WHERE b.name = $1 AND br.tenant_id = $2`,
        [BRANCH_NAME, tenantId],
    )) as { id: number; name: string }[];
    if (rows.length === 0) {
        throw new Error(
            `Branch "${BRANCH_NAME}" not found in tenant ${tenantId}`,
        );
    }
    if (rows.length > 1) {
        throw new Error(
            `Branch "${BRANCH_NAME}" is ambiguous in tenant ${tenantId} (ids ${rows
                .map((r) => r.id)
                .join(', ')}). Resolve by id instead of guessing.`,
        );
    }
    const branch = await branchRepo.findOne({ where: { id: rows[0].id } });
    if (!branch) throw new Error(`Branch id ${rows[0].id} vanished`);
    console.log(`Branch "${BRANCH_NAME}" → id ${branch.id}`);

    // Fail loudly if a permission name is wrong: granting a subset silently
    // would ship tablets that cannot take an order.
    const found = (await dataSource.query(
        `SELECT name FROM permissions WHERE name = ANY($1::text[])`,
        [SHIFT_MANAGER_PERMISSIONS],
    )) as { name: string }[];
    const missing = SHIFT_MANAGER_PERMISSIONS.filter(
        (p) => !found.some((f) => f.name === p),
    );
    if (missing.length) {
        throw new Error(`Permission(s) not in the catalog: ${missing.join(', ')}`);
    }

    // —— The shared role ——
    let role = await roleRepo.findOne({
        where: { slug: SHIFT_MANAGER_ROLE.slug },
    });
    if (!role) {
        role = await roleRepo.save(
            roleRepo.create({
                tenantId,
                name: SHIFT_MANAGER_ROLE.name,
                slug: SHIFT_MANAGER_ROLE.slug,
                orderHistoryDays: SHIFT_MANAGER_HISTORY_DAYS,
            }),
        );
        console.log(
            `Created role "${SHIFT_MANAGER_ROLE.name}" (id ${role.id})`,
        );
    } else {
        role.orderHistoryDays = SHIFT_MANAGER_HISTORY_DAYS;
        await roleRepo.save(role);
        console.log(
            `Role "${SHIFT_MANAGER_ROLE.name}" already exists (id ${role.id})`,
        );
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
        [role.id, SHIFT_MANAGER_PERMISSIONS],
    );
    await dataSource.query(
        `DELETE FROM role_permissions rp
         USING permissions p
         WHERE rp.permission_id = p.id
           AND rp.role_id = $1
           AND NOT (p.name = ANY($2::text[]))`,
        [role.id, SHIFT_MANAGER_PERMISSIONS],
    );
    const [{ count }] = (await dataSource.query(
        `SELECT count(*)::int AS count FROM role_permissions WHERE role_id = $1`,
        [role.id],
    )) as { count: number }[];
    console.log(
        `  permissions synced: ${count}` +
            ` (${SHIFT_MANAGER_PERMISSIONS.join(', ')})` +
            `, order history: ${SHIFT_MANAGER_HISTORY_DAYS} day(s)`,
    );

    // —— The four tablets ——
    console.log('\n— Shift manager tablets —');
    for (const staff of SHIFT_MANAGERS) {
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
            // Name only; an existing password is left alone so a re-run never
            // resets a credential the client may have already changed.
            user.name = staff.name;
            await userRepo.save(user);
            console.log(`User ${staff.email} already exists (id ${user.id})`);
        }

        // Tenant membership carries no role — the branch row does, which is
        // what makes them branch-scoped rather than tenant-wide.
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

        // brandId null ⇒ every brand on this branch.
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
        console.log(
            `  ${staff.email} → ${BRANCH_NAME} / all brands, "${SHIFT_MANAGER_ROLE.name}"`,
        );
    }

    console.log('\nAccounts (email / password):');
    for (const s of SHIFT_MANAGERS) {
        console.log(`  ${s.email.padEnd(26)} ${s.password}`);
    }
    await dataSource.destroy();
}

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
