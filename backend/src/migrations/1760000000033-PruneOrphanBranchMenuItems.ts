import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove orphaned branch_menu_items: per-branch menu mappings whose menu item
 * belongs to a brand that is no longer linked to that branch (branch_brands).
 * These were left behind when a brand was unlinked from a branch; they inflated
 * the "linked" count in branch-edit and, worse, remained sellable. Going forward
 * BranchesService.updateForAdmin prunes them on brand change and getBranchMenu
 * guards against them at read time.
 */
export class PruneOrphanBranchMenuItems1760000000033 implements MigrationInterface {
    name = 'PruneOrphanBranchMenuItems1760000000033';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DELETE FROM "branch_menu_items" bmi
            USING "menu_items" mi
            WHERE bmi."menu_item_id" = mi."id"
              AND NOT EXISTS (
                  SELECT 1 FROM "branch_brands" bb
                  WHERE bb."branch_id" = bmi."branch_id"
                    AND bb."brand_id" = mi."brand_id"
              )
        `);
    }

    public async down(): Promise<void> {
        // Irreversible: orphaned mappings are intentionally discarded.
    }
}
