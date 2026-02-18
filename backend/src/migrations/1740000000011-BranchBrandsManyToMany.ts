import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch–Brand many-to-many (e.g. food court: one branch, multiple brands).
 * - Create branch_brands join table
 * - Migrate existing branches.brand_id into branch_brands
 * - Drop branches.brand_id
 */
export class BranchBrandsManyToMany1740000000011 implements MigrationInterface {
    name = 'BranchBrandsManyToMany1740000000011';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE "branch_brands" (
        "branch_id" integer NOT NULL,
        "brand_id" integer NOT NULL,
        CONSTRAINT "PK_branch_brands" PRIMARY KEY ("branch_id", "brand_id"),
        CONSTRAINT "FK_branch_brands_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_branch_brands_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
      )
    `);

        await queryRunner.query(`
      INSERT INTO "branch_brands" ("branch_id", "brand_id")
      SELECT "id", "brand_id" FROM "branches" WHERE "brand_id" IS NOT NULL
    `);

        await queryRunner.query(
            `ALTER TABLE "branches" DROP CONSTRAINT IF EXISTS "FK_branches_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branches" DROP COLUMN IF EXISTS "brand_id"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "branches" ADD COLUMN "brand_id" integer`,
        );
        await queryRunner.query(`
      UPDATE "branches" b
      SET "brand_id" = (
        SELECT bb."brand_id" FROM "branch_brands" bb
        WHERE bb."branch_id" = b."id"
        LIMIT 1
      )
    `);
        await queryRunner.query(
            `ALTER TABLE "branches" ALTER COLUMN "brand_id" SET NOT NULL`,
        );
        await queryRunner.query(`
      ALTER TABLE "branches" ADD CONSTRAINT "FK_branches_brand"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
    `);
        await queryRunner.query(`DROP TABLE "branch_brands"`);
    }
}
