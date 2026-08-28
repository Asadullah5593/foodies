/**
 * menu-switch:apply — switch the four brands to the flyer menu, non-destructively.
 *
 *   1. Deactivate EVERY active item, category and add-on of the four brands
 *      (is_active = false). Their variants, option groups, modifiers and deal
 *      slots are left attached and untouched — unreachable once the item is
 *      inactive, and every historical order line already carries its own
 *      name/price snapshots.
 *   2. Create the flyer menu as brand-new rows: categories, items, variants,
 *      add-ons, option groups (cloned from the live item named in `from`,
 *      with flyer overrides), deal slots, branch links. The one uploaded
 *      image is carried across by name.
 *   3. Write a manifest (menu-switch-manifests/<db>.json) listing every id
 *      deactivated and created, so `menu-switch:revert` can flip it all back.
 *
 * Everything runs in ONE transaction: any failure rolls back completely.
 * Refuses to run twice (manifest status "applied") and refuses to run on
 * production unless MENU_SWITCH_ALLOW_PROD=1.
 *
 * Run: npm run menu-switch:apply
 */
import { QueryRunner } from 'typeorm';
import { FLYER_MENU } from './flyer-menu';
import type { FlyerBrand, FlyerItem, GroupOverride } from './types';
import {
    assertNotProd,
    assertSameChecksum,
    DB_HOST,
    DB_NAME,
    historyChecksum,
    LiveGroup,
    LiveItem,
    loadLiveItems,
    Manifest,
    openDataSource,
    readManifest,
    returningRows,
    slugify,
    writeManifest,
} from './lib';

type Row = { id: number };
/** Typed wrapper around QueryRunner.query (typeorm returns `any`). */
const sql = <T = Row>(qr: QueryRunner, text: string, params?: unknown[]) =>
    (qr.query(text, params) as Promise<unknown>).then((r) =>
        returningRows<T>(r),
    );
const warnings: string[] = [];

async function main() {
    assertNotProd('APPLY the menu switch');
    const existing = readManifest();
    if (existing?.status === 'applied') {
        console.error(
            `ABORT: manifest ${DB_NAME}.json says the switch is already applied (${existing.appliedAt}). Run menu-switch:revert first.`,
        );
        process.exit(1);
    }

    const ds = openDataSource();
    await ds.initialize();

    // ——— Resolve brands: slug first, then name ———
    const brands: Array<{
        id: number;
        name: string;
        slug: string;
        flyer: FlyerBrand;
    }> = [];
    for (const fb of FLYER_MENU) {
        const rows: Array<{ id: number; name: string; slug: string }> =
            await ds.query(
                `select id, name, slug from brands where slug = $1
             union all
             select id, name, slug from brands where lower(name) = lower($2) and slug <> $1
             limit 1`,
                [fb.slug, fb.name],
            );
        if (!rows.length) {
            console.error(`ABORT: brand not found for ${fb.slug} / ${fb.name}`);
            process.exit(1);
        }
        brands.push({ ...rows[0], flyer: fb });
    }
    const brandIds = brands.map((b) => b.id);
    console.log(
        `Target ${DB_NAME}@${DB_HOST} — brands: ${brands.map((b) => `${b.name}(#${b.id})`).join(', ')}`,
    );

    const live = await loadLiveItems(ds, brandIds);
    const before = await historyChecksum(ds);
    console.log(`History before: ${JSON.stringify(before)}`);

    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    const manifest: Manifest = {
        db: DB_NAME,
        host: DB_HOST,
        status: 'applied',
        appliedAt: new Date().toISOString(),
        brands: brands.map(({ id, name, slug }) => ({ id, name, slug })),
        deactivated: { items: [], categories: [], addons: [] },
        created: { items: [], categories: [], addons: [], groups: [] },
        checksumBefore: before,
    };
    try {
        // ===== 1. Deactivate the entire current menu of these brands =====
        const dItems: Row[] = await sql(
            qr,
            `update menu_items set is_active = false, updated_at = now() where brand_id = any($1::int[]) and is_active returning id`,
            [brandIds],
        );
        const dCats: Row[] = await sql(
            qr,
            `update menu_categories set is_active = false, updated_at = now() where brand_id = any($1::int[]) and is_active returning id`,
            [brandIds],
        );
        const dAddons: Row[] = await sql(
            qr,
            `update menu_addons set is_active = false, updated_at = now() where brand_id = any($1::int[]) and is_active returning id`,
            [brandIds],
        );
        manifest.deactivated = {
            items: dItems.map((r) => r.id),
            categories: dCats.map((r) => r.id),
            addons: dAddons.map((r) => r.id),
        };
        console.log(
            `Deactivated: ${dItems.length} items, ${dCats.length} categories, ${dAddons.length} add-ons`,
        );

        // ===== 2. Build the flyer menu =====
        for (const b of brands) {
            await buildBrand(
                qr,
                b,
                live.filter((i) => i.brand_id === b.id),
                manifest,
            );
        }

        // Manifest is printed before commit so the ids survive even if the file write fails.
        console.log(`MANIFEST ${JSON.stringify(manifest)}`);
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
    manifest.checksumAfter = after;
    writeManifest(manifest);

    // ===== 3. Summary =====
    console.log('\nMenu switch APPLIED (non-destructive).');
    for (const b of brands) {
        const [s]: Array<{ cats: number; items: number; deal_only: number }> =
            await ds.query(
                `select (select count(*)::int from menu_categories where brand_id=$1 and is_active) cats,
                    (select count(*)::int from menu_items i join menu_categories c on c.id=i.category_id where i.brand_id=$1 and i.is_active and c.is_active and not i.deal_only) items,
                    (select count(*)::int from menu_items where brand_id=$1 and is_active and deal_only) deal_only`,
                [b.id],
            );
        console.log(
            `  ${b.name}: ${s.cats} categories, ${s.items} sellable items (+${s.deal_only} deal-only)`,
        );
    }
    console.log(
        `  history checksum unchanged ✓  (${after.orders} orders / ${after.order_items} lines)`,
    );
    console.log(`  manifest: menu-switch-manifests/${DB_NAME}.json`);
    if (warnings.length) {
        console.log(`\nWARNINGS (${warnings.length}):`);
        for (const w of warnings) console.log(`  - ${w}`);
    }
    await ds.destroy();
}

async function buildBrand(
    qr: QueryRunner,
    b: { id: number; name: string; slug: string; flyer: FlyerBrand },
    live: LiveItem[],
    manifest: Manifest,
) {
    const fb = b.flyer;
    const liveByName = new Map(live.map((i) => [i.name, i]));
    const overrides = new Map<string, GroupOverride>(
        (fb.groupOverrides ?? []).map((o) => [o.match, o]),
    );
    // old modifier id → old group (for visible_when remapping)
    const liveGroupOfMod = new Map<number, LiveGroup>();
    for (const i of live)
        for (const g of i.groups ?? [])
            for (const m of g.modifiers ?? []) liveGroupOfMod.set(m.id, g);
    // old group id → clone
    const clones = new Map<
        number,
        {
            id: number;
            live: LiveGroup;
            modMap: Map<number, number>;
            overridden: boolean;
        }
    >();

    // — add-ons —
    const addonIds = new Map<string, number>();
    let addonSort = 0;
    for (const a of fb.addons ?? []) {
        const [r]: Row[] = await sql(
            qr,
            `insert into menu_addons (brand_id, category_id, name, price, is_active, sort_order) values ($1, null, $2, $3, true, $4) returning id`,
            [b.id, a.name, a.price, addonSort++],
        );
        addonIds.set(a.name, r.id);
        manifest.created.addons.push(r.id);
    }

    // — categories + items —
    const catIds = new Map<string, number>();
    const itemIds = new Map<string, number>();
    const deals: Array<{ item: FlyerItem; id: number }> = [];
    let catSort = 0;
    let itemSort = 0;
    for (const cat of fb.categories) {
        const [c]: Row[] = await sql(
            qr,
            `insert into menu_categories (brand_id, name, description, image_url, sort_order, is_active) values ($1,$2,$3,null,$4,true) returning id`,
            [b.id, cat.name, cat.description ?? null, catSort++],
        );
        catIds.set(cat.name, c.id);
        manifest.created.categories.push(c.id);

        for (const item of cat.items) {
            const fromName = item.from === undefined ? item.name : item.from;
            const src = fromName ? liveByName.get(fromName) : undefined;
            if (fromName && !src) {
                warnings.push(
                    `${b.name}: "${item.name}" — live item "${fromName}" not found; created WITHOUT option groups`,
                );
            }
            const [it]: Row[] = await sql(
                qr,
                `insert into menu_items (brand_id, category_id, name, slug, description, image_url, base_price, is_active, sort_order, deal_only, label)
                 values ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10) returning id`,
                [
                    b.id,
                    c.id,
                    item.name,
                    slugify(item.name, b.slug),
                    item.description ?? null,
                    src?.image_url ?? null,
                    item.price,
                    itemSort++,
                    item.dealOnly ?? false,
                    item.label ?? null,
                ],
            );
            itemIds.set(item.name, it.id);
            manifest.created.items.push(it.id);

            let vSort = 0;
            for (const v of item.variants ?? []) {
                await qr.query(
                    `insert into menu_variants (menu_item_id, name, size_key, price_modifier, is_default, sort_order) values ($1,$2,$3,$4,$5,$6)`,
                    [
                        it.id,
                        v.name,
                        v.sizeKey ?? null,
                        v.price - item.price,
                        v.isDefault ?? false,
                        vSort++,
                    ],
                );
            }
            for (const an of item.addons ?? []) {
                const aid = addonIds.get(an);
                if (!aid)
                    throw new Error(
                        `${b.name}: add-on "${an}" not defined at brand level`,
                    );
                await qr.query(
                    `insert into menu_item_addons (menu_item_id, addon_id) values ($1,$2) on conflict do nothing`,
                    [it.id, aid],
                );
            }

            // option groups — cloned from the live item
            if (src) {
                const excluded = new Set(item.excludeGroups ?? []);
                let pos = 0;
                for (const g of src.groups ?? []) {
                    if (excluded.has(g.name)) continue;
                    let clone = clones.get(g.group_id);
                    if (!clone) {
                        clone = await cloneGroup(
                            qr,
                            b.id,
                            g,
                            overrides.get(g.name),
                        );
                        clones.set(g.group_id, clone);
                        manifest.created.groups.push(clone.id);
                    }
                    await qr.query(
                        `insert into menu_item_modifier_groups (menu_item_id, modifier_group_id) values ($1,$2) on conflict do nothing`,
                        [it.id, clone.id],
                    );
                    await qr.query(
                        `insert into menu_item_modifier_group_positions (menu_item_id, modifier_group_id, sort_order) values ($1,$2,$3)
                         on conflict (menu_item_id, modifier_group_id) do update set sort_order = excluded.sort_order`,
                        [it.id, clone.id, pos++],
                    );
                }
            }
            if (item.slots) deals.push({ item, id: it.id });
        }
    }

    // — visible_when remap (conditional groups such as the meal-drink chooser) —
    for (const clone of clones.values()) {
        const vw = clone.live.visible_when;
        if (!vw?.length) continue;
        const mapped: number[] = [];
        for (const oldId of vw) {
            const owner = liveGroupOfMod.get(oldId);
            const ownerClone = owner ? clones.get(owner.group_id) : undefined;
            if (!ownerClone) continue; // controlling group not cloned → condition dropped
            const direct = ownerClone.modMap.get(oldId);
            if (direct) mapped.push(direct);
            else {
                // controlling group was overridden: fall back to "any PAID option of that group"
                const paid: Row[] = await sql(
                    qr,
                    `select id from modifiers where modifier_group_id = $1 and price > 0`,
                    [ownerClone.id],
                );
                mapped.push(...paid.map((p) => p.id));
            }
        }
        const uniq = [...new Set(mapped)];
        if (!uniq.length)
            warnings.push(
                `${b.name}: conditional group "${clone.live.name}" lost its trigger — now always shown`,
            );
        await qr.query(
            `update modifier_groups set visible_when_modifier_ids = $2 where id = $1`,
            [clone.id, uniq.length ? JSON.stringify(uniq) : null],
        );
    }

    // — deals —
    for (const { item, id } of deals) {
        let slot = 0;
        for (const s of item.slots ?? []) {
            const need = (name: string) => {
                const v = itemIds.get(name);
                if (!v)
                    throw new Error(
                        `${b.name}: deal "${item.name}" references unknown item "${name}"`,
                    );
                return v;
            };
            const sourceItem = s.type === 'fixed' ? need(s.item!) : null;
            const sourceCat =
                s.type === 'choice_category'
                    ? (catIds.get(s.category!) ??
                      (() => {
                          throw new Error(
                              `${b.name}: deal "${item.name}" references unknown category "${s.category}"`,
                          );
                      })())
                    : null;
            const sourceItems =
                s.type === 'choice_list' ? (s.items ?? []).map(need) : null;
            const surcharges = s.surcharges
                ? Object.fromEntries(
                      Object.entries(s.surcharges).map(([n, p]) => [
                          String(need(n)),
                          p,
                      ]),
                  )
                : null;
            await qr.query(
                `insert into deal_components (menu_item_id, slot_index, type, source_menu_item_id, source_category_id, source_menu_item_ids, quantity, optional, allow_customization, slot_surcharges, slot_size_key, allowed_size_keys, mirror_slot_index, mirror_match_size, mirror_match_category)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,null,false,false)`,
                [
                    id,
                    slot++,
                    s.type,
                    sourceItem,
                    sourceCat,
                    sourceItems ? JSON.stringify(sourceItems) : null,
                    s.qty ?? 1,
                    s.optional ?? false,
                    s.customize ?? true,
                    surcharges ? JSON.stringify(surcharges) : null,
                    s.sizeKey ?? null,
                ],
            );
        }
    }

    // — branch links —
    const branches: Row[] = await sql(
        qr,
        `select branch_id as id from branch_brands where brand_id = $1`,
        [b.id],
    );
    for (const br of branches) {
        for (const iid of itemIds.values()) {
            await qr.query(
                `insert into branch_menu_items (branch_id, menu_item_id, price_override, is_available, is_hidden_online) values ($1,$2,null,true,false) on conflict do nothing`,
                [br.id, iid],
            );
        }
    }
    console.log(
        `  ${b.name}: ${catIds.size} categories, ${itemIds.size} items, ${clones.size} option groups, ${deals.length} deals, ${branches.length} branch(es)`,
    );
}

async function cloneGroup(
    qr: QueryRunner,
    brandId: number,
    g: LiveGroup,
    ov?: GroupOverride,
) {
    const cfg = {
        minSelect: g.min,
        maxSelect: g.max,
        includedQuantity: g.included,
        allowQuantity: g.allow_qty,
        hideInDeals: g.hide_in_deals,
        ...(ov?.cfg ?? {}),
    };
    const [r]: Row[] = await sql(
        qr,
        `insert into modifier_groups (brand_id, name, min_select, max_select, min_select_by_size, max_select_by_size, included_quantity, included_by_size, allow_quantity, price_tiers, hide_in_deals, visible_when_modifier_ids)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null) returning id`,
        [
            brandId,
            ov?.rename ?? g.name,
            cfg.minSelect,
            cfg.maxSelect,
            g.min_by_size ? JSON.stringify(g.min_by_size) : null,
            g.max_by_size ? JSON.stringify(g.max_by_size) : null,
            cfg.includedQuantity,
            g.included_by_size ? JSON.stringify(g.included_by_size) : null,
            cfg.allowQuantity,
            g.price_tiers ? JSON.stringify(g.price_tiers) : null,
            cfg.hideInDeals,
        ],
    );
    const modMap = new Map<number, number>();
    if (ov?.modifiers) {
        let s = 0;
        for (const m of ov.modifiers) {
            await qr.query(
                `insert into modifiers (modifier_group_id, name, price, price_by_size, available_for_sizes, sort_order) values ($1,$2,$3,null,null,$4)`,
                [r.id, m.name, m.price ?? 0, s++],
            );
        }
    } else {
        let s = 0;
        for (const m of g.modifiers ?? []) {
            const [nm]: Row[] = await sql(
                qr,
                `insert into modifiers (modifier_group_id, name, price, price_by_size, available_for_sizes, sort_order) values ($1,$2,$3,$4,$5,$6) returning id`,
                [
                    r.id,
                    m.name,
                    m.price,
                    m.price_by_size ? JSON.stringify(m.price_by_size) : null,
                    m.sizes ? JSON.stringify(m.sizes) : null,
                    s++,
                ],
            );
            modMap.set(m.id, nm.id);
        }
    }
    return { id: r.id, live: g, modMap, overridden: !!ov?.modifiers };
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
