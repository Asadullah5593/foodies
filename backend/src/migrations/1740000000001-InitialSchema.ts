import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Full schema from scratch (Company → Brand → Branch).
 * Run after DB drop. Creates all tables in dependency order.
 */
export class InitialSchema1740000000001 implements MigrationInterface {
    name = 'InitialSchema1740000000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Tenants (Company)
        await queryRunner.query(`
      CREATE TABLE "tenants" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "legal_name" text,
        "slug" character varying NOT NULL,
        "default_currency" character(3) NOT NULL DEFAULT 'USD',
        "default_timezone" character varying NOT NULL DEFAULT 'UTC',
        "default_tax_rate" numeric(5,4) NOT NULL DEFAULT 0,
        "default_service_charge" numeric(5,4) NOT NULL DEFAULT 0,
        "loyalty_enabled" boolean NOT NULL DEFAULT false,
        "status" character varying NOT NULL DEFAULT 'active',
        "settings" json,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenants_slug" UNIQUE ("slug"),
        CONSTRAINT "PK_tenants" PRIMARY KEY ("id")
      )
    `);

        // 2. Brands
        await queryRunner.query(`
      CREATE TABLE "brands" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "description" text,
        "logo_url" character varying,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_brands" PRIMARY KEY ("id"),
        CONSTRAINT "FK_brands_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX "IDX_brands_tenant_slug" ON "brands" ("tenant_id", "slug")`,
        );

        // 3. Branches
        await queryRunner.query(`
      CREATE TABLE "branches" (
        "id" SERIAL NOT NULL,
        "brand_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "code" character varying NOT NULL,
        "address" text,
        "phone" character varying,
        "email" character varying,
        "timezone" character varying NOT NULL DEFAULT 'UTC',
        "operating_hours" jsonb,
        "supports_dine_in" boolean NOT NULL DEFAULT true,
        "supports_takeaway" boolean NOT NULL DEFAULT true,
        "supports_pickup" boolean NOT NULL DEFAULT true,
        "supports_delivery" boolean NOT NULL DEFAULT false,
        "delivery_flat_fee" numeric(10,2) NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "status" character varying NOT NULL DEFAULT 'active',
        "settings" json,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_branches_code" UNIQUE ("code"),
        CONSTRAINT "PK_branches" PRIMARY KEY ("id"),
        CONSTRAINT "FK_branches_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
      )
    `);

        // 4. Users (global identity)
        await queryRunner.query(`
      CREATE TABLE "users" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "email" character varying,
        "email_verified_at" TIMESTAMP,
        "password" character varying NOT NULL,
        "phone" character varying,
        "status" character varying NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

        // 5. Tenant users (company-level role)
        await queryRunner.query(`
      CREATE TABLE "tenant_users" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "role" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tenant_users_tenant_user" UNIQUE ("tenant_id", "user_id"),
        CONSTRAINT "PK_tenant_users" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_users_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tenant_users_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

        // 6. Branch users (with role)
        await queryRunner.query(`
      CREATE TABLE "branch_users" (
        "branch_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "role" character varying NOT NULL DEFAULT 'cashier',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_branch_users" PRIMARY KEY ("branch_id", "user_id"),
        CONSTRAINT "FK_branch_users_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_branch_users_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

        // 7. Menu categories
        await queryRunner.query(`
      CREATE TABLE "menu_categories" (
        "id" SERIAL NOT NULL,
        "brand_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_menu_categories" PRIMARY KEY ("id"),
        CONSTRAINT "FK_menu_categories_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
      )
    `);

        // 8. Menu items
        await queryRunner.query(`
      CREATE TABLE "menu_items" (
        "id" SERIAL NOT NULL,
        "brand_id" integer NOT NULL,
        "category_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "description" text,
        "image_url" character varying,
        "base_price" numeric(10,2) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_menu_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_menu_items_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_menu_items_category" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE CASCADE
      )
    `);

        // 9. Menu addons (legacy / transition)
        await queryRunner.query(`
      CREATE TABLE "menu_addons" (
        "id" SERIAL NOT NULL,
        "brand_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_menu_addons" PRIMARY KEY ("id"),
        CONSTRAINT "FK_menu_addons_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
      )
    `);

        // 10. Menu variants
        await queryRunner.query(`
      CREATE TABLE "menu_variants" (
        "id" SERIAL NOT NULL,
        "menu_item_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "price_modifier" numeric(10,2) NOT NULL DEFAULT 0,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_menu_variants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_menu_variants_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE
      )
    `);

        // 11. Menu item addons (junction)
        await queryRunner.query(`
      CREATE TABLE "menu_item_addons" (
        "menu_item_id" integer NOT NULL,
        "addon_id" integer NOT NULL,
        CONSTRAINT "PK_menu_item_addons" PRIMARY KEY ("menu_item_id", "addon_id"),
        CONSTRAINT "FK_menu_item_addons_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_menu_item_addons_addon" FOREIGN KEY ("addon_id") REFERENCES "menu_addons"("id") ON DELETE CASCADE
      )
    `);

        // 12. Modifier groups
        await queryRunner.query(`
      CREATE TABLE "modifier_groups" (
        "id" SERIAL NOT NULL,
        "brand_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "min_select" integer NOT NULL DEFAULT 0,
        "max_select" integer NOT NULL DEFAULT 1,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_modifier_groups" PRIMARY KEY ("id"),
        CONSTRAINT "FK_modifier_groups_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
      )
    `);

        // 13. Modifiers
        await queryRunner.query(`
      CREATE TABLE "modifiers" (
        "id" SERIAL NOT NULL,
        "modifier_group_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "price" numeric(10,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_modifiers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_modifiers_modifier_group" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE
      )
    `);

        // 14. Menu item modifier groups (junction)
        await queryRunner.query(`
      CREATE TABLE "menu_item_modifier_groups" (
        "menu_item_id" integer NOT NULL,
        "modifier_group_id" integer NOT NULL,
        CONSTRAINT "PK_menu_item_modifier_groups" PRIMARY KEY ("menu_item_id", "modifier_group_id"),
        CONSTRAINT "FK_mimg_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_mimg_modifier_group" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE
      )
    `);

        // 15. Branch menu items
        await queryRunner.query(`
      CREATE TABLE "branch_menu_items" (
        "id" SERIAL NOT NULL,
        "branch_id" integer NOT NULL,
        "menu_item_id" integer NOT NULL,
        "price_override" numeric(10,2),
        "is_available" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_branch_menu_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_branch_menu_items_branch_item" UNIQUE ("branch_id", "menu_item_id"),
        CONSTRAINT "FK_branch_menu_items_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_branch_menu_items_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE
      )
    `);

        // 16. Discounts (before orders for FK)
        await queryRunner.query(`
      CREATE TABLE "discounts" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "code" character varying,
        "type" character varying NOT NULL,
        "value" numeric(10,2) NOT NULL,
        "min_order_amount" numeric(10,2),
        "max_discount_amount" numeric(10,2),
        "is_active" boolean NOT NULL DEFAULT true,
        "pos_only" boolean NOT NULL DEFAULT false,
        "allowed_roles" jsonb,
        "valid_from" TIMESTAMP,
        "valid_until" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_discounts_code" UNIQUE ("code"),
        CONSTRAINT "PK_discounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_discounts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

        // 17. Orders
        await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "brand_id" integer NOT NULL,
        "branch_id" integer NOT NULL,
        "order_number" character varying NOT NULL,
        "order_type" character varying NOT NULL,
        "table_number" character varying,
        "customer_name" character varying,
        "customer_phone" character varying,
        "customer_id" integer,
        "status" character varying NOT NULL DEFAULT 'placed',
        "source" character varying NOT NULL DEFAULT 'pos',
        "delivery_address" text,
        "subtotal" numeric(12,2) NOT NULL DEFAULT 0,
        "discount_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "tax_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "service_charge" numeric(12,2) NOT NULL DEFAULT 0,
        "delivery_fee" numeric(12,2) NOT NULL DEFAULT 0,
        "total_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "discount_id" integer,
        "discount_code" character varying,
        "placed_at" TIMESTAMP NOT NULL DEFAULT now(),
        "loyalty_points_earned" integer NOT NULL DEFAULT 0,
        "loyalty_points_redeemed" integer NOT NULL DEFAULT 0,
        "notes" text,
        "completed_at" TIMESTAMP,
        "cancelled_at" TIMESTAMP,
        "created_by" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_orders_order_number" UNIQUE ("order_number"),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_orders_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_orders_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_orders_discount" FOREIGN KEY ("discount_id") REFERENCES "discounts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_orders_creator" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
        await queryRunner.query(
            `CREATE INDEX "IDX_orders_branch_placed" ON "orders" ("branch_id", "placed_at")`,
        );

        // 18. Customers (for orders.customer_id FK we add after)
        await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "phone" character varying NOT NULL,
        "name" character varying,
        "loyalty_points_balance" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_customers_tenant_phone" UNIQUE ("tenant_id", "phone"),
        CONSTRAINT "PK_customers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customers_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

        await queryRunner.query(`
      ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL
    `);

        // 19. Order items
        await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" SERIAL NOT NULL,
        "order_id" integer NOT NULL,
        "menu_item_id" integer NOT NULL,
        "variant_id" integer,
        "name_snapshot" text,
        "price_snapshot" numeric(10,2),
        "quantity" integer NOT NULL,
        "unit_price" numeric(10,2) NOT NULL,
        "subtotal" numeric(10,2) NOT NULL,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_variant" FOREIGN KEY ("variant_id") REFERENCES "menu_variants"("id") ON DELETE SET NULL
      )
    `);

        // 20. Order item addons
        await queryRunner.query(`
      CREATE TABLE "order_item_addons" (
        "id" SERIAL NOT NULL,
        "order_item_id" integer NOT NULL,
        "addon_id" integer NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "unit_price" numeric(10,2) NOT NULL,
        "subtotal" numeric(10,2) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_item_addons" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_item_addons_order_item" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_item_addons_addon" FOREIGN KEY ("addon_id") REFERENCES "menu_addons"("id") ON DELETE CASCADE
      )
    `);

        // 21. Order item modifiers
        await queryRunner.query(`
      CREATE TABLE "order_item_modifiers" (
        "id" SERIAL NOT NULL,
        "order_item_id" integer NOT NULL,
        "modifier_id" integer,
        "name_snapshot" text,
        "price_snapshot" numeric(10,2),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_item_modifiers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_item_modifiers_order_item" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_item_modifiers_modifier" FOREIGN KEY ("modifier_id") REFERENCES "modifiers"("id") ON DELETE SET NULL
      )
    `);

        // 22. Payments
        await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" SERIAL NOT NULL,
        "order_id" integer NOT NULL,
        "payment_method" character varying NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "reference_number" character varying,
        "status" character varying NOT NULL DEFAULT 'pending',
        "processed_at" TIMESTAMP,
        "paid_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);

        // 23. Loyalty transactions
        await queryRunner.query(`
      CREATE TABLE "loyalty_transactions" (
        "id" SERIAL NOT NULL,
        "customer_id" integer NOT NULL,
        "order_id" integer,
        "points" integer NOT NULL,
        "type" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loyalty_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_loyalty_transactions_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_loyalty_transactions_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL
      )
    `);

        // 24. Kitchen stations
        await queryRunner.query(`
      CREATE TABLE "kitchen_stations" (
        "id" SERIAL NOT NULL,
        "branch_id" integer NOT NULL,
        "name" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kitchen_stations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kitchen_stations_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE
      )
    `);

        // 25. Printer routes
        await queryRunner.query(`
      CREATE TABLE "printer_routes" (
        "id" SERIAL NOT NULL,
        "branch_id" integer NOT NULL,
        "category_id" integer,
        "station_id" integer,
        "printer_name" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_printer_routes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_printer_routes_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_printer_routes_category" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_printer_routes_station" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL
      )
    `);

        // 26. Shifts
        await queryRunner.query(`
      CREATE TABLE "shifts" (
        "id" SERIAL NOT NULL,
        "branch_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "shift_number" character varying NOT NULL,
        "opening_cash" numeric(12,2) NOT NULL DEFAULT 0,
        "closing_cash" numeric(12,2),
        "expected_cash" numeric(12,2),
        "opened_at" TIMESTAMP NOT NULL,
        "closed_at" TIMESTAMP,
        "status" character varying NOT NULL DEFAULT 'open',
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_shifts_branch_shift" UNIQUE ("branch_id", "shift_number"),
        CONSTRAINT "PK_shifts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_shifts_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_shifts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

        // 27. Permissions (RBAC)
        await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "resource" character varying NOT NULL,
        "action" character varying NOT NULL,
        "description" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_permissions_name" UNIQUE ("name"),
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id")
      )
    `);

        // 28. Roles (RBAC)
        await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer,
        "name" character varying NOT NULL,
        "slug" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_roles_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);

        // 29. Role permissions (junction)
        await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "role_id" integer NOT NULL,
        "permission_id" integer NOT NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("role_id", "permission_id"),
        CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tables = [
            'role_permissions',
            'roles',
            'permissions',
            'shifts',
            'printer_routes',
            'kitchen_stations',
            'loyalty_transactions',
            'payments',
            'order_item_modifiers',
            'order_item_addons',
            'order_items',
            'orders',
            'customers',
            'discounts',
            'branch_menu_items',
            'menu_item_modifier_groups',
            'modifiers',
            'modifier_groups',
            'menu_item_addons',
            'menu_variants',
            'menu_addons',
            'menu_items',
            'menu_categories',
            'branch_users',
            'tenant_users',
            'users',
            'branches',
            'brands',
            'tenants',
        ];
        for (const table of tables) {
            await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        }
    }
}
