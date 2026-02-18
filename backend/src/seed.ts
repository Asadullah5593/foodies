/**
 * Seed: tenants (each with own products/categories), brands, branches, users per tenant.
 * Owner role has ALL permissions. You can log in as different tenant users to verify.
 * Run: npm run seed or npm run db:reset
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { TenantUser } from './entities/tenant-user.entity';
import { BranchUser } from './entities/branch-user.entity';
import { Brand } from './entities/brand.entity';
import { Branch } from './entities/branch.entity';
import { BranchBrand } from './entities/branch-brand.entity';
import { MenuCategory } from './entities/menu-category.entity';
import { MenuItem } from './entities/menu-item.entity';
import { BranchMenuItem } from './entities/branch-menu-item.entity';
import { Permission } from './entities/permission.entity';
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

const PASSWORD = 'owner123';

async function seed() {
    await dataSource.initialize();
    const tenantRepo = dataSource.getRepository(Tenant);
    if ((await tenantRepo.count()) > 0) {
        console.log('Database already has data, skipping seed.');
        await dataSource.destroy();
        return;
    }

    const userRepo = dataSource.getRepository(User);
    const tenantUserRepo = dataSource.getRepository(TenantUser);
    const brandRepo = dataSource.getRepository(Brand);
    const branchRepo = dataSource.getRepository(Branch);
    const branchBrandRepo = dataSource.getRepository(BranchBrand);
    const branchUserRepo = dataSource.getRepository(BranchUser);
    const categoryRepo = dataSource.getRepository(MenuCategory);
    const menuItemRepo = dataSource.getRepository(MenuItem);
    const branchMenuItemRepo = dataSource.getRepository(BranchMenuItem);
    const hashed = await bcrypt.hash(PASSWORD, 10);

    // —— Permissions & Roles (owner has ALL permissions) ——
    const permissionRepo = dataSource.getRepository(Permission);
    const permissionRows = [
        {
            name: 'orders:create',
            resource: 'orders',
            action: 'create',
            description: 'Create orders',
        },
        {
            name: 'orders:view',
            resource: 'orders',
            action: 'view',
            description: 'View orders',
        },
        {
            name: 'orders:void',
            resource: 'orders',
            action: 'void',
            description: 'Void orders',
        },
        {
            name: 'discounts:apply',
            resource: 'discounts',
            action: 'apply',
            description: 'Apply discounts',
        },
        {
            name: 'reports:view',
            resource: 'reports',
            action: 'view',
            description: 'View reports',
        },
        {
            name: 'branches:manage',
            resource: 'branches',
            action: 'manage',
            description: 'Manage branches',
        },
        {
            name: 'branch-menu:manage',
            resource: 'branch-menu',
            action: 'manage',
            description: 'Manage branch menu (link/de-link items, overrides)',
        },
        {
            name: 'branch-users:assign',
            resource: 'branch-users',
            action: 'assign',
            description:
                'Assign/unassign users to branches (tenant/super admin only)',
        },
        {
            name: 'kitchen:view',
            resource: 'kitchen',
            action: 'view',
            description: 'View kitchen orders',
        },
        {
            name: 'kitchen:update',
            resource: 'kitchen',
            action: 'update',
            description: 'Update kitchen order status',
        },
    ];
    const existingNames = new Set(
        (await permissionRepo.find({ select: ['name'] })).map((p) => p.name),
    );
    const toInsert = permissionRows.filter((p) => !existingNames.has(p.name));
    if (toInsert.length > 0) {
        await permissionRepo.save(toInsert);
    }

    const roleRepo = dataSource.getRepository(Role);
    const superAdminRole = await roleRepo.save(
        roleRepo.create({
            tenantId: null,
            name: 'Super Admin',
            slug: 'super_admin',
        }),
    );
    const ownerRole = await roleRepo.save(
        roleRepo.create({ tenantId: null, name: 'Owner', slug: 'owner' }),
    );
    const managerRole = await roleRepo.save(
        roleRepo.create({ tenantId: null, name: 'Manager', slug: 'manager' }),
    );
    const branchManagerRole = await roleRepo.save(
        roleRepo.create({
            tenantId: null,
            name: 'Branch Manager',
            slug: 'branch_manager',
        }),
    );
    const cashierRole = await roleRepo.save(
        roleRepo.create({ tenantId: null, name: 'Cashier', slug: 'cashier' }),
    );
    const kitchenRole = await roleRepo.save(
        roleRepo.create({ tenantId: null, name: 'Kitchen', slug: 'kitchen' }),
    );
    let riderRole = await roleRepo.findOne({ where: { slug: 'rider' } });
    if (!riderRole) {
        riderRole = await roleRepo.save(
            roleRepo.create({ tenantId: null, name: 'Rider', slug: 'rider' }),
        );
    }

    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT ${superAdminRole.id}, id FROM permissions`,
    );
    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT ${ownerRole.id}, id FROM permissions`,
    );
    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT ${managerRole.id}, id FROM permissions WHERE name IN ('orders:create', 'orders:view', 'discounts:apply', 'branches:manage')`,
    );
    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT ${branchManagerRole.id}, id FROM permissions WHERE name IN ('orders:create', 'orders:view', 'discounts:apply', 'branch-menu:manage', 'reports:view')`,
    );
    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT ${cashierRole.id}, id FROM permissions WHERE name IN ('orders:create', 'orders:view', 'discounts:apply')`,
    );
    await dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT ${kitchenRole.id}, id FROM permissions WHERE name IN ('kitchen:view', 'kitchen:update', 'orders:view')`,
    );

    // —— Super admin: no tenant_users row → tenantId null → sees all tenants/brands/branches ——
    await userRepo.save(
        userRepo.create({
            name: 'Super Admin',
            email: 'superadmin@demo.com',
            password: hashed,
            status: 'active',
        }),
    );
    // Do NOT add superAdmin to tenant_users; they have access to everything via tenantId = null

    // —— Tenant 1: Acme Corp ——
    const tenant1 = await tenantRepo.save(
        tenantRepo.create({
            name: 'Acme Corp',
            slug: 'acme-corp',
            legalName: null,
            defaultCurrency: 'USD',
            defaultTimezone: 'UTC',
            defaultTaxRate: 0.1,
            defaultServiceCharge: 0,
            loyaltyEnabled: false,
            status: 'active',
        }),
    );
    const user1 = await userRepo.save(
        userRepo.create({
            name: 'Acme Owner',
            email: 'acme_owner@demo.com',
            password: hashed,
            status: 'active',
        }),
    );
    await tenantUserRepo.save(
        tenantUserRepo.create({
            tenantId: tenant1.id,
            userId: user1.id,
            roleId: ownerRole.id,
        }),
    );

    const brand1 = await brandRepo.save(
        brandRepo.create({
            tenantId: tenant1.id,
            name: 'Acme Eats',
            slug: 'acme-eats',
            description: null,
            logoUrl: null,
            isActive: true,
        }),
    );
    const branch1 = await branchRepo.save(
        branchRepo.create({
            name: 'Downtown',
            code: 'ACME-DT',
            address: null,
            phone: null,
            email: null,
            timezone: 'UTC',
            operatingHours: null,
            supportsDineIn: true,
            supportsTakeaway: true,
            supportsPickup: true,
            supportsDelivery: false,
            deliveryFlatFee: 0,
            isActive: true,
            status: 'active',
        }),
    );
    await branchBrandRepo.save(
        branchBrandRepo.create({ branchId: branch1.id, brandId: brand1.id }),
    );
    await branchUserRepo.save(
        branchUserRepo.create({
            branchId: branch1.id,
            userId: user1.id,
            roleId: cashierRole.id,
        }),
    );

    // Acme rider (delivery only; no admin permissions)
    const acmeRider = await userRepo.save(
        userRepo.create({
            name: 'Acme Rider',
            email: 'acme_rider@demo.com',
            password: hashed,
            status: 'active',
        }),
    );
    await tenantUserRepo.save(
        tenantUserRepo.create({
            tenantId: tenant1.id,
            userId: acmeRider.id,
            roleId: riderRole.id,
        }),
    );
    await branchUserRepo.save(
        branchUserRepo.create({
            branchId: branch1.id,
            userId: acmeRider.id,
            roleId: riderRole.id,
        }),
    );

    // Acme cashier: tenant_users → Acme (sees Acme data), branch_users → Downtown only (assigned to one branch)
    const acmeCashier = await userRepo.save(
        userRepo.create({
            name: 'Acme Cashier',
            email: 'acme_cashier@demo.com',
            password: hashed,
            status: 'active',
        }),
    );
    await tenantUserRepo.save(
        tenantUserRepo.create({
            tenantId: tenant1.id,
            userId: acmeCashier.id,
            roleId: cashierRole.id,
        }),
    );
    await branchUserRepo.save(
        branchUserRepo.create({
            branchId: branch1.id,
            userId: acmeCashier.id,
            roleId: cashierRole.id,
        }),
    );

    const cat1 = await categoryRepo.save(
        categoryRepo.create({
            brandId: brand1.id,
            name: 'Mains',
            sortOrder: 0,
            isActive: true,
        }),
    );
    const acmeBurger = await menuItemRepo.save(
        menuItemRepo.create({
            brandId: brand1.id,
            categoryId: cat1.id,
            name: 'Acme Burger',
            slug: 'acme-burger',
            description: null,
            imageUrl: null,
            basePrice: 12.99,
            isActive: true,
            sortOrder: 0,
        }),
    );
    await branchMenuItemRepo.save(
        branchMenuItemRepo.create({
            branchId: branch1.id,
            menuItemId: acmeBurger.id,
            priceOverride: null,
            isAvailable: true,
            isHiddenOnline: false,
        }),
    );

    // —— Tenant 2: Beta Foods ——
    const tenant2 = await tenantRepo.save(
        tenantRepo.create({
            name: 'Beta Foods',
            slug: 'beta-foods',
            legalName: null,
            defaultCurrency: 'USD',
            defaultTimezone: 'UTC',
            defaultTaxRate: 0.08,
            defaultServiceCharge: 0.05,
            loyaltyEnabled: true,
            status: 'active',
        }),
    );
    const user2 = await userRepo.save(
        userRepo.create({
            name: 'Beta Owner',
            email: 'beta_owner@demo.com',
            password: hashed,
            status: 'active',
        }),
    );
    await tenantUserRepo.save(
        tenantUserRepo.create({
            tenantId: tenant2.id,
            userId: user2.id,
            roleId: ownerRole.id,
        }),
    );

    const brand2 = await brandRepo.save(
        brandRepo.create({
            tenantId: tenant2.id,
            name: 'Beta Kitchen',
            slug: 'beta-kitchen',
            description: null,
            logoUrl: null,
            isActive: true,
        }),
    );
    const branch2a = await branchRepo.save(
        branchRepo.create({
            name: 'Main',
            code: 'BETA-MAIN',
            address: null,
            phone: null,
            email: null,
            timezone: 'UTC',
            operatingHours: null,
            supportsDineIn: true,
            supportsTakeaway: true,
            supportsPickup: true,
            supportsDelivery: true,
            deliveryFlatFee: 3.5,
            isActive: true,
            status: 'active',
        }),
    );
    await branchBrandRepo.save(
        branchBrandRepo.create({ branchId: branch2a.id, brandId: brand2.id }),
    );
    const branch2b = await branchRepo.save(
        branchRepo.create({
            name: 'West',
            code: 'BETA-WEST',
            address: null,
            phone: null,
            email: null,
            timezone: 'UTC',
            operatingHours: null,
            supportsDineIn: true,
            supportsTakeaway: true,
            supportsPickup: true,
            supportsDelivery: false,
            deliveryFlatFee: 0,
            isActive: true,
            status: 'active',
        }),
    );
    await branchBrandRepo.save(
        branchBrandRepo.create({ branchId: branch2b.id, brandId: brand2.id }),
    );
    await branchUserRepo.save(
        branchUserRepo.create({
            branchId: branch2a.id,
            userId: user2.id,
            roleId: cashierRole.id,
        }),
    );
    await branchUserRepo.save(
        branchUserRepo.create({
            branchId: branch2b.id,
            userId: user2.id,
            roleId: cashierRole.id,
        }),
    );

    const cat2 = await categoryRepo.save(
        categoryRepo.create({
            brandId: brand2.id,
            name: 'Drinks',
            sortOrder: 0,
            isActive: true,
        }),
    );
    const betaSmoothie = await menuItemRepo.save(
        menuItemRepo.create({
            brandId: brand2.id,
            categoryId: cat2.id,
            name: 'Beta Smoothie',
            slug: 'beta-smoothie',
            description: null,
            imageUrl: null,
            basePrice: 6.5,
            isActive: true,
            sortOrder: 0,
        }),
    );
    await branchMenuItemRepo.save(
        branchMenuItemRepo.create({
            branchId: branch2a.id,
            menuItemId: betaSmoothie.id,
            priceOverride: null,
            isAvailable: true,
            isHiddenOnline: false,
        }),
    );
    await branchMenuItemRepo.save(
        branchMenuItemRepo.create({
            branchId: branch2b.id,
            menuItemId: betaSmoothie.id,
            priceOverride: null,
            isAvailable: true,
            isHiddenOnline: false,
        }),
    );

    console.log(`
Seeded (users, tenant_users, branch_users):

  users table:         Identity only (who can log in).
  tenant_users table:  Which tenant → what data they SEE (no row = super admin).
  branch_users table:  Which branches they're ASSIGNED to (POS/KDS/shifts).

  Login accounts (password: ${PASSWORD}):

  | Email                 | tenant_users     | branch_users      | Frontend effect                    |
  |-----------------------|------------------|------------------|------------------------------------|
  | superadmin@demo.com  | none (super admin) | none           | Sees ALL tenants, brands, branches |
  | acme_owner@demo.com   | Acme Corp (owner)  | Downtown       | Sees only Acme data                |
  | beta_owner@demo.com  | Beta Foods (owner) | Main, West     | Sees only Beta data                |
  | acme_cashier@demo.com | Acme Corp (cashier)| Downtown only  | Sees only Acme; assigned 1 branch  |
  | acme_rider@demo.com   | Acme Corp (rider)  | Downtown       | Rider app only (assigned deliveries)|

  Log in with each to verify: Brands/Branches/Tenants scope and Create Branch (multi-select brands).`);
    await dataSource.destroy();
}

seed().catch((e) => {
    console.error(e);
    process.exit(1);
});
