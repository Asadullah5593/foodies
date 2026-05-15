import { MigrationInterface, QueryRunner } from 'typeorm';

export class RiderHrmAndDispatchFoundation1760000000012 implements MigrationInterface {
    name = 'RiderHrmAndDispatchFoundation1760000000012';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "branches"
      ADD COLUMN IF NOT EXISTS "delivery_radius_km" decimal(8,2) NOT NULL DEFAULT 10
    `);

        await queryRunner.query(`
      ALTER TABLE "rider_order_ratings"
      ADD COLUMN IF NOT EXISTS "comment" text
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_profiles" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "tenant_id" integer NOT NULL,
        "employment_status" varchar(32) NOT NULL DEFAULT 'active',
        "salary_type" varchar(32) NOT NULL DEFAULT 'hybrid',
        "employee_code" varchar(64),
        "base_salary" decimal(12,2) NOT NULL DEFAULT 0,
        "default_per_ride_commission" decimal(12,2) NOT NULL DEFAULT 0,
        "max_active_orders" integer NOT NULL DEFAULT 1,
        "min_rating" decimal(4,2),
        "min_timely_rate" decimal(5,2),
        "is_active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_rider_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_rider_profiles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_profiles_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_profiles_tenant_id"
      ON "rider_profiles" ("tenant_id")
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_attendance_sessions" (
        "id" SERIAL NOT NULL,
        "rider_user_id" integer NOT NULL,
        "branch_id" integer NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'checked_in',
        "checked_in_at" TIMESTAMP NOT NULL DEFAULT now(),
        "checked_out_at" TIMESTAMP,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_attendance_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rider_attendance_sessions_user" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_attendance_sessions_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rider_attendance_open_session"
      ON "rider_attendance_sessions" ("rider_user_id")
      WHERE "checked_out_at" IS NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_attendance_branch_status"
      ON "rider_attendance_sessions" ("branch_id", "status")
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_presences" (
        "rider_user_id" integer NOT NULL,
        "branch_id" integer,
        "is_checked_in" boolean NOT NULL DEFAULT false,
        "is_paused" boolean NOT NULL DEFAULT false,
        "pause_reason" text,
        "last_heartbeat_at" TIMESTAMP,
        "last_location_at" TIMESTAMP,
        "last_latitude" decimal(10,7),
        "last_longitude" decimal(10,7),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_presences" PRIMARY KEY ("rider_user_id"),
        CONSTRAINT "FK_rider_presences_user" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_presences_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_presences_branch_checked_in"
      ON "rider_presences" ("branch_id", "is_checked_in", "is_paused")
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_comp_plans" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "branch_id" integer,
        "name" varchar(120) NOT NULL,
        "pay_method" varchar(32) NOT NULL DEFAULT 'hybrid',
        "status" varchar(32) NOT NULL DEFAULT 'draft',
        "version" integer NOT NULL DEFAULT 1,
        "effective_from" date,
        "effective_to" date,
        "created_by" integer,
        "approved_by" integer,
        "approved_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_comp_plans" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rider_comp_plans_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_comp_plans_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_comp_plans_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_comp_plans_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_comp_plans_scope"
      ON "rider_comp_plans" ("tenant_id", "branch_id", "status")
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_comp_plan_components" (
        "id" SERIAL NOT NULL,
        "plan_id" integer NOT NULL,
        "component_key" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "component_type" varchar(32) NOT NULL,
        "calc_basis" varchar(32) NOT NULL,
        "value" decimal(12,2) NOT NULL DEFAULT 0,
        "conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_enabled" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_comp_plan_components" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rider_comp_plan_components_plan" FOREIGN KEY ("plan_id") REFERENCES "rider_comp_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_comp_plan_components_plan_id"
      ON "rider_comp_plan_components" ("plan_id", "sort_order")
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_dispatch_states" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "branch_id" integer NOT NULL,
        "last_assigned_rider_user_id" integer,
        "last_assigned_at" TIMESTAMP,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_dispatch_states" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_rider_dispatch_state_scope" UNIQUE ("tenant_id", "branch_id"),
        CONSTRAINT "FK_rider_dispatch_states_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_dispatch_states_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_dispatch_states_rider" FOREIGN KEY ("last_assigned_rider_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_assignment_ledger" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "branch_id" integer NOT NULL,
        "order_id" integer NOT NULL,
        "event_type" varchar(32) NOT NULL,
        "assignment_request_id" varchar(100),
        "selected_rider_user_id" integer,
        "eligible_rider_user_ids" jsonb NOT NULL DEFAULT '[]',
        "skipped_riders" jsonb NOT NULL DEFAULT '[]',
        "reason_code" varchar(64),
        "reason_detail" text,
        "created_by" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_assignment_ledger" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rider_assignment_ledger_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_assignment_ledger_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_assignment_ledger_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_assignment_ledger_rider" FOREIGN KEY ("selected_rider_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_assignment_ledger_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rider_assignment_request_id"
      ON "rider_assignment_ledger" ("assignment_request_id")
      WHERE "assignment_request_id" IS NOT NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_assignment_ledger_order_id"
      ON "rider_assignment_ledger" ("order_id", "created_at")
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_payroll_runs" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "branch_id" integer,
        "period_from" date NOT NULL,
        "period_to" date NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'draft',
        "rule_version" varchar(80),
        "requested_by" integer,
        "approved_by" integer,
        "approved_at" TIMESTAMP,
        "finalized_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_payroll_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rider_payroll_runs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_payroll_runs_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_payroll_runs_requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_payroll_runs_approved_by" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_payroll_runs_scope"
      ON "rider_payroll_runs" ("tenant_id", "branch_id", "period_from", "period_to")
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_payroll_lines" (
        "id" SERIAL NOT NULL,
        "run_id" integer NOT NULL,
        "rider_user_id" integer NOT NULL,
        "plan_id" integer,
        "currency" varchar(8) NOT NULL DEFAULT 'PKR',
        "total_amount" decimal(12,2) NOT NULL DEFAULT 0,
        "attendance_minutes" integer NOT NULL DEFAULT 0,
        "completed_rides" integer NOT NULL DEFAULT 0,
        "timely_deliveries" integer NOT NULL DEFAULT 0,
        "avg_rating" decimal(4,2),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_payroll_lines" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_rider_payroll_run_rider" UNIQUE ("run_id", "rider_user_id"),
        CONSTRAINT "FK_rider_payroll_lines_run" FOREIGN KEY ("run_id") REFERENCES "rider_payroll_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_payroll_lines_rider" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_payroll_lines_plan" FOREIGN KEY ("plan_id") REFERENCES "rider_comp_plans"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_payroll_line_items" (
        "id" SERIAL NOT NULL,
        "payroll_line_id" integer NOT NULL,
        "component_key" varchar(80) NOT NULL,
        "component_name" varchar(120) NOT NULL,
        "amount" decimal(12,2) NOT NULL DEFAULT 0,
        "formula_meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_payroll_line_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rider_payroll_line_items_line" FOREIGN KEY ("payroll_line_id") REFERENCES "rider_payroll_lines"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_payroll_line_items_line_id"
      ON "rider_payroll_line_items" ("payroll_line_id")
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_payroll_line_items_line_id"`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS "rider_payroll_line_items"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_payroll_lines"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_payroll_runs_scope"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_payroll_runs"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_assignment_ledger_order_id"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_rider_assignment_request_id"`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS "rider_assignment_ledger"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_dispatch_states"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_comp_plan_components_plan_id"`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS "rider_comp_plan_components"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_comp_plans_scope"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_comp_plans"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_presences_branch_checked_in"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_presences"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_attendance_branch_status"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_rider_attendance_open_session"`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS "rider_attendance_sessions"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_profiles_tenant_id"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_profiles"`);
        await queryRunner.query(
            `ALTER TABLE "rider_order_ratings" DROP COLUMN IF EXISTS "comment"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branches" DROP COLUMN IF EXISTS "delivery_radius_km"`,
        );
    }
}
