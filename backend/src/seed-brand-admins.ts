/**
 * Seed: "Brand Admin" role + one brand-locked admin user per brand of the
 * foodies@demo.com tenant.
 *
 * A brand admin can run every brand-scoped module (dashboard, orders, POS,
 * kitchen, FOH, menu, deals, discounts, customers, users, shifts, reports)
 * but only for their own brand — enforcement happens server-side via the
 * branch_users.brand_id lock. They get no tenant-wide permissions
 * (no all-branches:access, branches/roles/business-settings management).
 *
 * Idempotent: safe to re-run. Run: npm run seed:brand-admins
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { User } from './entities/user.entity';
import { TenantUser } from './entities/tenant-user.entity';
import { BranchUser } from './entities/branch-user.entity';
import { Brand } from './entities/brand.entity';
import { BranchBrand } from './entities/branch-brand.entity';
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
    synchronize: false,
    entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
});

const OWNER_EMAIL = 'foodies@demo.com';
const PASSWORD = 'brand123';

const BRAND_ADMIN_PERMISSIONS = [
    'dashboard:view',
    'orders:create',
    'orders:view',
    'orders:void',
    'discounts:apply',
    'discounts:manage',
    'reports:view',
    'menu:manage',
    'branch-menu:manage',
    'deals:view',
    'deals:create',
    'deals:edit',
    'deals:delete',
    'kitchen:view',
    'kitchen:update',
    'back-kitchen:view',
    'users:manage',
    'branch-users:assign',
    'customers:manage',
    'shifts:manage',
    'deliveries:view',
    'rider-share:request',
    // Brand-scoped inventory: see own brand stock across branches, request
    // transfers in, and approve/dispatch pulls FROM their own brand bucket
    // (per-bucket authority enforced server-side in the transfer service).
    'inventory:view:brand',
    'inventory:transfer:request',
    'inventory:transfer:approve',
];

/** Known brand → account email mapping; falls back to a compacted name. */
const EMAIL_BY_BRAND_NAME: Record<string, string> = {
    'peperi. co': 'peperi@demo.com',
    'wok & go': 'wokandgo@demo.com',
    fireaway: 'fireaway@demo.com',
};

function emailForBrand(name: string): string {
    const mapped = EMAIL_BY_BRAND_NAME[name.trim().toLowerCase()];
    if (mapped) return mapped;
    const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${compact}@demo.com`;
}

async function seed() {
    await dataSource.initialize();
    const userRepo = dataSource.getRepository(User);
    const tenantUserRepo = dataSource.getRepository(TenantUser);
    const branchUserRepo = dataSource.getRepository(BranchUser);
    const brandRepo = dataSource.getRepository(Brand);
    const branchBrandRepo = dataSource.getRepository(BranchBrand);
    const roleRepo = dataSource.getRepository(Role);

    const owner = await userRepo.findOne({ where: { email: OWNER_EMAIL } });
    if (!owner) throw new Error(`Owner user ${OWNER_EMAIL} not found`);
    const ownerTenantUser = await tenantUserRepo.findOne({
        where: { userId: owner.id },
    });
    if (!ownerTenantUser)
        throw new Error(`${OWNER_EMAIL} has no tenant_users row`);
    const tenantId = ownerTenantUser.tenantId;
    console.log(`Tenant of ${OWNER_EMAIL}: ${tenantId}`);

    // —— Role ——
    let role = await roleRepo.findOne({ where: { slug: 'brand_admin' } });
    if (!role) {
        role = await roleRepo.save(
            roleRepo.create({
                tenantId: null,
                name: 'Brand Admin',
                slug: 'brand_admin',
            }),
        );
        console.log(`Created role "Brand Admin" (id ${role.id})`);
    } else {
        console.log(`Role "Brand Admin" already exists (id ${role.id})`);
    }
    // Re-sync permissions (insert missing ones only).
    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p
         WHERE p.name = ANY($2::text[])
           AND NOT EXISTS (
             SELECT 1 FROM role_permissions rp
             WHERE rp.role_id = $1 AND rp.permission_id = p.id
           )`,
        [role.id, BRAND_ADMIN_PERMISSIONS],
    );
    console.log('Role permissions synced');

    // —— One brand admin per active brand of the tenant ——
    const brands = await brandRepo.find({
        where: { tenantId, isActive: true },
        order: { id: 'ASC' },
    });
    const hashed = await bcrypt.hash(PASSWORD, 10);

    for (const brand of brands) {
        const email = emailForBrand(brand.name);
        let user = await userRepo.findOne({ where: { email } });
        if (!user) {
            user = await userRepo.save(
                userRepo.create({
                    name: `${brand.name} Admin`,
                    email,
                    password: hashed,
                    status: 'active',
                }),
            );
            console.log(`Created user ${email} (id ${user.id})`);
        } else {
            console.log(`User ${email} already exists (id ${user.id})`);
        }

        const existingTu = await tenantUserRepo.findOne({
            where: { userId: user.id, tenantId },
        });
        if (!existingTu) {
            await tenantUserRepo.save(
                tenantUserRepo.create({
                    tenantId,
                    userId: user.id,
                    roleId: null,
                }),
            );
        }

        // Assign to every branch that carries this brand, locked to it.
        const links = await branchBrandRepo.find({
            where: { brandId: brand.id },
        });
        for (const link of links) {
            const existing = await branchUserRepo.findOne({
                where: { branchId: link.branchId, userId: user.id },
            });
            if (existing) {
                existing.roleId = role.id;
                existing.brandId = brand.id;
                await branchUserRepo.save(existing);
            } else {
                await branchUserRepo.save(
                    branchUserRepo.create({
                        branchId: link.branchId,
                        userId: user.id,
                        roleId: role.id,
                        brandId: brand.id,
                    }),
                );
            }
            console.log(
                `  ${email} → branch ${link.branchId} (brand ${brand.name})`,
            );
        }
    }

    console.log('\nBrand admin accounts (password: brand123):');
    for (const brand of brands) {
        console.log(`  ${brand.name}: ${emailForBrand(brand.name)}`);
    }
    await dataSource.destroy();
}

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
