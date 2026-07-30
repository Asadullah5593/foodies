import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow a 100% staff discount — a full comp granted at the till.
 *
 * 1760000000103 refused it on the reasoning that writing off a whole bill is a
 * void or a refund, with its own approval trail. The client wants the button
 * instead, so the CHECK comes off and 100 becomes a legal preset value. Above
 * 100 is still rejected (in the service): a discount larger than the bill is a
 * data-entry slip, not an intent.
 *
 * The controls that actually bound this are unchanged and still apply:
 * `roles.max_staff_discount_percent` decides who may grant it (a role must be
 * set to 100, or left null/uncapped — nobody inherits the right), the tenant's
 * maximum-total-discount cap still clamps the order, and the cost floor still
 * applies where a menu item carries a cost price.
 */
export class StaffDiscountAllowFullComp1760000000105 implements MigrationInterface {
    name = 'StaffDiscountAllowFullComp1760000000105';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE staff_discounts DROP CONSTRAINT IF EXISTS "CHK_staff_discounts_percent_below_100"`,
        );
        // A percentage over 100 was never reachable and stays impossible.
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE staff_discounts ADD CONSTRAINT "CHK_staff_discounts_percent_max_100" CHECK (
                    discount_type <> 'percentage' OR value <= 100
                );
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Fails if a 100% preset has since been created — delete or lower it
        // first. Deliberate: reverting must not silently drop a live button.
        await queryRunner.query(
            `ALTER TABLE staff_discounts DROP CONSTRAINT IF EXISTS "CHK_staff_discounts_percent_max_100"`,
        );
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE staff_discounts ADD CONSTRAINT "CHK_staff_discounts_percent_below_100" CHECK (
                    discount_type <> 'percentage' OR value < 100
                );
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
    }
}
