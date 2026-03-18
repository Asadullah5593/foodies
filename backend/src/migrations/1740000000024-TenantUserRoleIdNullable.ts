import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow tenant_users to have no role on create; role can be assigned later.
 */
export class TenantUserRoleIdNullable1740000000024 implements MigrationInterface {
    name = 'TenantUserRoleIdNullable1740000000024';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "tenant_users"
      ALTER COLUMN "role_id" DROP NOT NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "tenant_users"
      ALTER COLUMN "role_id" SET NOT NULL
    `);
    }
}
