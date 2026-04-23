import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventorySchema1740000000042 implements MigrationInterface {
    name = 'InventorySchema1740000000042';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "uoms" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "name" character varying NOT NULL,
                "code" character varying NOT NULL,
                "kind" character varying NOT NULL DEFAULT 'count',
                "base_uom_id" integer,
                "multiplier_to_base" numeric(18,6),
                "is_active" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_uoms" PRIMARY KEY ("id"),
                CONSTRAINT "FK_uoms_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_uoms_base_uom" FOREIGN KEY ("base_uom_id") REFERENCES "uoms"("id") ON DELETE SET NULL,
                CONSTRAINT "UQ_uoms_tenant_code" UNIQUE ("tenant_id", "code")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "vendors" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "name" character varying NOT NULL,
                "type" character varying NOT NULL DEFAULT 'supplier',
                "linked_branch_id" integer,
                "email" character varying,
                "phone" character varying,
                "address" text,
                "is_active" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_vendors" PRIMARY KEY ("id"),
                CONSTRAINT "FK_vendors_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_vendors_branch" FOREIGN KEY ("linked_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_vendors_tenant_type" ON "vendors" ("tenant_id", "type")`,
        );

        await queryRunner.query(`
            CREATE TABLE "inventory_items" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "name" character varying NOT NULL,
                "code" character varying NOT NULL,
                "type" character varying NOT NULL DEFAULT 'ingredient',
                "base_uom_id" integer NOT NULL,
                "track_expiry" boolean NOT NULL DEFAULT true,
                "track_lot" boolean NOT NULL DEFAULT true,
                "is_active" boolean NOT NULL DEFAULT true,
                "default_reorder_point" numeric(18,6),
                "default_near_expiry_days" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_inventory_items" PRIMARY KEY ("id"),
                CONSTRAINT "FK_inventory_items_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_inventory_items_base_uom" FOREIGN KEY ("base_uom_id") REFERENCES "uoms"("id") ON DELETE RESTRICT,
                CONSTRAINT "UQ_inventory_items_tenant_code" UNIQUE ("tenant_id", "code")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_inventory_items_tenant_type" ON "inventory_items" ("tenant_id", "type")`,
        );

        await queryRunner.query(`
            CREATE TABLE "inventory_item_branch_settings" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "reorder_point" numeric(18,6),
                "near_expiry_days" integer,
                "is_active" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_inventory_item_branch_settings" PRIMARY KEY ("id"),
                CONSTRAINT "FK_iibs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_iibs_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_iibs_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE,
                CONSTRAINT "UQ_iibs_branch_item" UNIQUE ("branch_id", "inventory_item_id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_iibs_tenant_branch" ON "inventory_item_branch_settings" ("tenant_id", "branch_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE "inventory_locations" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "name" character varying NOT NULL,
                "code" character varying NOT NULL,
                "is_active" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_inventory_locations" PRIMARY KEY ("id"),
                CONSTRAINT "FK_inventory_locations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_inventory_locations_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "UQ_inventory_locations_branch_code" UNIQUE ("branch_id", "code")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "purchase_requisitions" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "requesting_branch_id" integer NOT NULL,
                "requested_from_vendor_id" integer NOT NULL,
                "status" character varying NOT NULL DEFAULT 'draft',
                "notes" text,
                "approved_by" integer,
                "approved_at" TIMESTAMP,
                "created_by" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_purchase_requisitions" PRIMARY KEY ("id"),
                CONSTRAINT "FK_pr_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_pr_branch" FOREIGN KEY ("requesting_branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_pr_vendor" FOREIGN KEY ("requested_from_vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_pr_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_pr_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_pr_tenant_branch_status" ON "purchase_requisitions" ("tenant_id", "requesting_branch_id", "status")`,
        );

        await queryRunner.query(`
            CREATE TABLE "purchase_requisition_lines" (
                "id" SERIAL NOT NULL,
                "purchase_requisition_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "requested_qty" numeric(18,6) NOT NULL,
                "requested_uom_id" integer NOT NULL,
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_purchase_requisition_lines" PRIMARY KEY ("id"),
                CONSTRAINT "FK_prl_pr" FOREIGN KEY ("purchase_requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_prl_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_prl_uom" FOREIGN KEY ("requested_uom_id") REFERENCES "uoms"("id") ON DELETE RESTRICT
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_prl_pr" ON "purchase_requisition_lines" ("purchase_requisition_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE "purchase_orders" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "po_number" character varying NOT NULL,
                "buyer_branch_id" integer NOT NULL,
                "vendor_id" integer NOT NULL,
                "purchase_requisition_id" integer,
                "status" character varying NOT NULL DEFAULT 'created',
                "expected_delivery_date" date,
                "notes" text,
                "approved_by" integer,
                "approved_at" TIMESTAMP,
                "created_by" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_purchase_orders" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_purchase_orders_po_number" UNIQUE ("po_number"),
                CONSTRAINT "FK_po_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_po_branch" FOREIGN KEY ("buyer_branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_po_vendor" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_po_pr" FOREIGN KEY ("purchase_requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_po_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_po_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_po_tenant_branch_status" ON "purchase_orders" ("tenant_id", "buyer_branch_id", "status")`,
        );

        await queryRunner.query(`
            CREATE TABLE "purchase_order_lines" (
                "id" SERIAL NOT NULL,
                "purchase_order_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "ordered_qty" numeric(18,6) NOT NULL,
                "ordered_uom_id" integer NOT NULL,
                "unit_cost" numeric(18,6),
                "tax_rate" numeric(9,6),
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_purchase_order_lines" PRIMARY KEY ("id"),
                CONSTRAINT "FK_pol_po" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_pol_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_pol_uom" FOREIGN KEY ("ordered_uom_id") REFERENCES "uoms"("id") ON DELETE RESTRICT
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_pol_po" ON "purchase_order_lines" ("purchase_order_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE "goods_receipt_notes" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "purchase_order_id" integer NOT NULL,
                "status" character varying NOT NULL DEFAULT 'draft',
                "received_by" integer,
                "received_at" TIMESTAMP,
                "posted_at" TIMESTAMP,
                "posted_by" integer,
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_goods_receipt_notes" PRIMARY KEY ("id"),
                CONSTRAINT "FK_grn_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_grn_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_grn_po" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_grn_received_by" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_grn_posted_by" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_grn_po_status" ON "goods_receipt_notes" ("purchase_order_id", "status")`,
        );

        await queryRunner.query(`
            CREATE TABLE "goods_receipt_note_lines" (
                "id" SERIAL NOT NULL,
                "goods_receipt_note_id" integer NOT NULL,
                "purchase_order_line_id" integer,
                "inventory_item_id" integer NOT NULL,
                "received_qty" numeric(18,6) NOT NULL,
                "received_uom_id" integer NOT NULL,
                "lot_code" character varying,
                "expiry_date" date,
                "location_id" integer,
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_goods_receipt_note_lines" PRIMARY KEY ("id"),
                CONSTRAINT "FK_grnl_grn" FOREIGN KEY ("goods_receipt_note_id") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_grnl_pol" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_grnl_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_grnl_uom" FOREIGN KEY ("received_uom_id") REFERENCES "uoms"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_grnl_location" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "inventory_batches" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "vendor_id" integer,
                "purchase_order_id" integer,
                "goods_receipt_note_id" integer,
                "lot_code" character varying,
                "batch_version" character varying NOT NULL DEFAULT 'v1',
                "expiry_date" date,
                "received_at" TIMESTAMP NOT NULL DEFAULT now(),
                "status" character varying NOT NULL DEFAULT 'available',
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_inventory_batches" PRIMARY KEY ("id"),
                CONSTRAINT "FK_batches_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_batches_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_batches_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_batches_vendor" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_batches_po" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_batches_grn" FOREIGN KEY ("goods_receipt_note_id") REFERENCES "goods_receipt_notes"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_batches_branch_item_expiry" ON "inventory_batches" ("branch_id", "inventory_item_id", "expiry_date")`,
        );

        await queryRunner.query(`
            CREATE TABLE "inventory_on_hand" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "location_id" integer,
                "qty" numeric(18,6) NOT NULL DEFAULT 0,
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_inventory_on_hand" PRIMARY KEY ("id"),
                CONSTRAINT "FK_ioh_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_ioh_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_ioh_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_ioh_location" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
                CONSTRAINT "UQ_ioh_branch_item_location" UNIQUE ("branch_id", "inventory_item_id", "location_id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_ioh_tenant_branch_item" ON "inventory_on_hand" ("tenant_id", "branch_id", "inventory_item_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE "inventory_batch_on_hand" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "inventory_batch_id" integer NOT NULL,
                "location_id" integer,
                "qty" numeric(18,6) NOT NULL DEFAULT 0,
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_inventory_batch_on_hand" PRIMARY KEY ("id"),
                CONSTRAINT "FK_iboh_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_iboh_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_iboh_batch" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_iboh_location" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
                CONSTRAINT "UQ_iboh_branch_batch_location" UNIQUE ("branch_id", "inventory_batch_id", "location_id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_iboh_branch_batch" ON "inventory_batch_on_hand" ("branch_id", "inventory_batch_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE "inventory_ledger_entries" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "inventory_batch_id" integer,
                "location_id" integer,
                "qty_delta" numeric(18,6) NOT NULL,
                "event_type" character varying NOT NULL,
                "event_ref_type" character varying,
                "event_ref_id" integer,
                "idempotency_key" character varying,
                "notes" text,
                "created_by" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_inventory_ledger_entries" PRIMARY KEY ("id"),
                CONSTRAINT "FK_ile_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_ile_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_ile_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_ile_batch" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_ile_location" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_ile_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_ile_branch_item_created" ON "inventory_ledger_entries" ("branch_id", "inventory_item_id", "created_at")`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX "UQ_ile_idempotency_key" ON "inventory_ledger_entries" ("idempotency_key") WHERE idempotency_key IS NOT NULL`,
        );

        await queryRunner.query(`
            CREATE TABLE "wastage_events" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "inventory_batch_id" integer,
                "location_id" integer,
                "qty" numeric(18,6) NOT NULL,
                "reason" character varying NOT NULL,
                "notes" text,
                "created_by" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_wastage_events" PRIMARY KEY ("id"),
                CONSTRAINT "FK_we_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_we_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_we_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_we_batch" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_we_location" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_we_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "stocktakes" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "week_start" date NOT NULL,
                "week_end" date NOT NULL,
                "finance_day" date NOT NULL,
                "status" character varying NOT NULL DEFAULT 'open',
                "submitted_by" integer,
                "submitted_at" TIMESTAMP,
                "closed_by" integer,
                "closed_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_stocktakes" PRIMARY KEY ("id"),
                CONSTRAINT "FK_stocktakes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_stocktakes_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_stocktakes_submitted_by" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_stocktakes_closed_by" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL,
                CONSTRAINT "UQ_stocktakes_branch_week" UNIQUE ("branch_id", "week_start")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_stocktakes_tenant_branch_status" ON "stocktakes" ("tenant_id", "branch_id", "status")`,
        );

        await queryRunner.query(`
            CREATE TABLE "stocktake_lines" (
                "id" SERIAL NOT NULL,
                "stocktake_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "counted_qty" numeric(18,6) NOT NULL,
                "counted_uom_id" integer NOT NULL,
                "location_id" integer,
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_stocktake_lines" PRIMARY KEY ("id"),
                CONSTRAINT "FK_stl_stocktake" FOREIGN KEY ("stocktake_id") REFERENCES "stocktakes"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_stl_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_stl_uom" FOREIGN KEY ("counted_uom_id") REFERENCES "uoms"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_stl_location" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL,
                CONSTRAINT "UQ_stl_stocktake_item_location" UNIQUE ("stocktake_id", "inventory_item_id", "location_id")
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "recipes" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "menu_item_id" integer NOT NULL,
                "variant_id" integer,
                "version" integer NOT NULL DEFAULT 1,
                "status" character varying NOT NULL DEFAULT 'draft',
                "yield_qty" numeric(18,6),
                "yield_uom_id" integer,
                "notes" text,
                "created_by" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_recipes" PRIMARY KEY ("id"),
                CONSTRAINT "FK_recipes_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_recipes_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_recipes_variant" FOREIGN KEY ("variant_id") REFERENCES "menu_variants"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_recipes_yield_uom" FOREIGN KEY ("yield_uom_id") REFERENCES "uoms"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_recipes_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_recipes_tenant_menu_variant_status" ON "recipes" ("tenant_id", "menu_item_id", "variant_id", "status")`,
        );

        await queryRunner.query(`
            CREATE TABLE "recipe_lines" (
                "id" SERIAL NOT NULL,
                "recipe_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "qty" numeric(18,6) NOT NULL,
                "uom_id" integer NOT NULL,
                "wastage_factor" numeric(9,6),
                "notes" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_recipe_lines" PRIMARY KEY ("id"),
                CONSTRAINT "FK_recipe_lines_recipe" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_recipe_lines_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_recipe_lines_uom" FOREIGN KEY ("uom_id") REFERENCES "uoms"("id") ON DELETE RESTRICT
            )
        `);

        await queryRunner.query(`
            CREATE TABLE "recipe_cost_snapshots" (
                "id" SERIAL NOT NULL,
                "recipe_id" integer NOT NULL,
                "computed_at" TIMESTAMP NOT NULL DEFAULT now(),
                "total_cost" numeric(18,6) NOT NULL DEFAULT 0,
                "currency" character varying,
                "cost_breakdown" jsonb,
                CONSTRAINT "PK_recipe_cost_snapshots" PRIMARY KEY ("id"),
                CONSTRAINT "FK_rcs_recipe" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_rcs_recipe_computed" ON "recipe_cost_snapshots" ("recipe_id", "computed_at")`,
        );

        await queryRunner.query(`
            CREATE TABLE "inventory_item_costs" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "effective_at" TIMESTAMP NOT NULL DEFAULT now(),
                "unit_cost" numeric(18,6) NOT NULL,
                "currency" character varying,
                "source_type" character varying NOT NULL DEFAULT 'grn',
                "source_id" integer,
                CONSTRAINT "PK_inventory_item_costs" PRIMARY KEY ("id"),
                CONSTRAINT "FK_iic_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_iic_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_iic_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_iic_branch_item_effective" ON "inventory_item_costs" ("branch_id", "inventory_item_id", "effective_at")`,
        );

        await queryRunner.query(`
            CREATE TABLE "order_inventory_allocations" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "order_id" integer NOT NULL,
                "inventory_item_id" integer NOT NULL,
                "inventory_batch_id" integer NOT NULL,
                "qty" numeric(18,6) NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_order_inventory_allocations" PRIMARY KEY ("id"),
                CONSTRAINT "FK_oia_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_oia_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_oia_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_oia_item" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT,
                CONSTRAINT "FK_oia_batch" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT
            )
        `);
        await queryRunner.query(
            `CREATE INDEX "IDX_oia_order" ON "order_inventory_allocations" ("order_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tables = [
            'order_inventory_allocations',
            'inventory_item_costs',
            'recipe_cost_snapshots',
            'recipe_lines',
            'recipes',
            'stocktake_lines',
            'stocktakes',
            'wastage_events',
            'inventory_ledger_entries',
            'inventory_batch_on_hand',
            'inventory_on_hand',
            'inventory_batches',
            'goods_receipt_note_lines',
            'goods_receipt_notes',
            'purchase_order_lines',
            'purchase_orders',
            'purchase_requisition_lines',
            'purchase_requisitions',
            'inventory_locations',
            'inventory_item_branch_settings',
            'inventory_items',
            'vendors',
            'uoms',
        ];
        for (const table of tables) {
            await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        }
    }
}

