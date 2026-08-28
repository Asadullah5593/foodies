/**
 * menu-switch:revert — undo `menu-switch:apply` using its manifest.
 *
 *   - the rows the switch CREATED are deactivated (never deleted — by now
 *     they may carry sales, and deleting them would cascade into those
 *     order lines)
 *   - the rows the switch DEACTIVATED are reactivated
 *
 * Variants, option groups, modifiers and deal slots are untouched either
 * way. One transaction; order-history checksum asserted unchanged.
 *
 * Run: npm run menu-switch:revert
 */
import {
    assertNotProd,
    assertSameChecksum,
    DB_HOST,
    DB_NAME,
    historyChecksum,
    openDataSource,
    readManifest,
    returningRows,
    writeManifest,
} from './lib';

async function main() {
    assertNotProd('REVERT the menu switch');
    const m = readManifest();
    if (!m || m.status !== 'applied') {
        console.error(
            m
                ? `ABORT: manifest ${DB_NAME}.json is already "${m.status}" (${m.revertedAt ?? m.appliedAt}).`
                : `ABORT: no manifest for ${DB_NAME} — nothing to revert.`,
        );
        process.exit(1);
    }
    if (m.db !== DB_NAME) {
        console.error(
            `ABORT: manifest is for database "${m.db}", current target is "${DB_NAME}".`,
        );
        process.exit(1);
    }

    const ds = openDataSource();
    await ds.initialize();
    const before = await historyChecksum(ds);
    console.log(
        `Target ${DB_NAME}@${DB_HOST} — reverting switch applied ${m.appliedAt}`,
    );
    console.log(`History before: ${JSON.stringify(before)}`);

    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
        const off = async (table: string, ids: number[]) =>
            ids.length
                ? returningRows(
                      await qr.query(
                          `update ${table} set is_active = false, updated_at = now() where id = any($1::int[]) and is_active returning id`,
                          [ids],
                      ),
                  ).length
                : 0;
        const on = async (table: string, ids: number[]) =>
            ids.length
                ? returningRows(
                      await qr.query(
                          `update ${table} set is_active = true, updated_at = now() where id = any($1::int[]) and not is_active returning id`,
                          [ids],
                      ),
                  ).length
                : 0;

        console.log(
            `Deactivating flyer rows: ${await off('menu_items', m.created.items)} items, ${await off('menu_categories', m.created.categories)} categories, ${await off('menu_addons', m.created.addons)} add-ons`,
        );
        console.log(
            `Reactivating previous rows: ${await on('menu_items', m.deactivated.items)} items, ${await on('menu_categories', m.deactivated.categories)} categories, ${await on('menu_addons', m.deactivated.addons)} add-ons`,
        );
        await qr.commitTransaction();
    } catch (e) {
        await qr.rollbackTransaction();
        console.error('FAILED — transaction rolled back, nothing changed.');
        throw e;
    } finally {
        await qr.release();
    }

    const after = await historyChecksum(ds);
    assertSameChecksum(before, after);
    m.status = 'reverted';
    m.revertedAt = new Date().toISOString();
    writeManifest(m);
    console.log(
        `\nMenu switch REVERTED. History checksum unchanged ✓ (${after.orders} orders / ${after.order_items} lines)`,
    );
    console.log(
        `The flyer rows remain in the database, inactive; menu-switch:apply may be run again.`,
    );
    await ds.destroy();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
