# Lunch Deals — production runbook

How to add the 1pm–5pm lunch deals for **Peperi Co**, **Fireaway** and **Wok & Go** to the
production menu. Two routes: the script (recommended) or the admin GUI.

Nothing here has been run against production. The script defaults to a dry run.

> **Status: config verified against production, ready to dry-run.** All four discovery
> blockers are closed and the config is pinned to prod's real names.
>
> Note that even after a successful `--commit`, **nothing goes live**: the deals are created
> detached from every branch. See *The deals are created detached from every branch*.

---

## What gets created

Seven deal roots, each `available_time_start = 13:00`, `available_time_end = 17:00`, every day.

| Brand | Deal | Price | Contents |
|---|---|---|---|
| Peperi Co | 2 Old & Gold Smashed Burgers | 1899 | 2 × Old & Gold Smashed |
| Peperi Co | 2 Smashed Classic Burgers | 1899 | 2 × Smashed Classic |
| Peperi Co | 2 Quarter Chicken with Rice and Drinks | 1499 | 2 × 1/4 Peri Peri Chicken + 2 × Peri Peri Rice + 2 × 345ml drink (choice of 4) |
| Fireaway | Classic Pizza and 1L Drink Lunch Deal | 1499 | any item from the **Classic** category (12") + Pepsi 1L |
| Fireaway | Signature Pizza and 1L Drink Lunch Deal | 1599 | any item from the **Signature** category (12") + Pepsi 1L |
| Wok & Go | Any Two Classic Meals | 2199 | 2 × any Large from **Classic Meals** (9 choices) |
| Wok & Go | Any Two Meals from the Sea | 2599 | 2 × any Large from **From the Sea** (3 choices) |

The Fireaway drink is a **fixed** Pepsi 1L, not a chooser: it is the only active one-litre
product on the brand, so a one-option chooser would cost the till a click per order. The
script comments show the one-line change back to a chooser if more 1L drinks are re-activated.

All seven are filed under the existing **`Lunch Deal`** category on each brand. The script
never creates a category — if `Lunch Deal` is missing on a brand it aborts rather than
inventing one.

A "deal" in this system is a **menu item in a deals category** plus its `deal_components` slot
rows. The deal root's `base_price` *is* the deal price — fixed-mode deals are priced from
`getEffectiveUnitPrice(branch, dealRootId)`, not from the slot contents.

### The deals are created detached from every branch

`ATTACH_TO_BRANCHES` is **`false`**, so the script creates the deals and writes **no**
`branch_menu_items` rows.

A menu item with no `branch_menu_items` row does not appear on that branch's menu at all —
`getMenuForBranch` builds the menu from that table. So after the run the deals exist, are
priced and have their slots, but are **invisible on POS, app and web**. Nothing goes live
until someone attaches them.

To put them live later, either flip `ATTACH_TO_BRANCHES = true` and re-run (it is idempotent,
and only adds rows that are missing), or attach them per branch in the admin.

---

## Verified against production

Production differs from dev in ways that would each have broken the run. All confirmed by
query and now pinned in the config:

| Thing | Dev | **Production** |
|---|---|---|
| `Lunch Deal` category | *(none)* | **active on all three brands** (500 / 501 / 502) |
| Fireaway Classic/Signature | one category, split on `label` | **two categories, `Classic` and `Signature`** (6 active items each); `label` is empty brand-wide |
| Fireaway pizza `size_key` | `12` | **`12`** — size pin correct |
| Fireaway 1L drinks | 5 flavours | **only `Pepsi 1L` is active** — modelled as a fixed slot |
| Peperi 345ml drinks | 5 flavours | **4 active**: `7Up`, `Dew`, `Mirinda`, `Pepsi` |
| Drink spelling | `7up`, `Mountain Dew` | **`7Up`, `Dew`** |
| Wok classic range | `Classic Boxes` | **`Classic Meals`** (9 items, all `large`, Rs 1449) |
| Wok seafood range | *(none)* | **`From the Sea`** (3 items, all `large`, Rs 1749) |
| Peperi burger prices | 899 | **999** |

Two categories are duplicated on prod — Fireaway `Drinks` and Peperi Co `Deals` (432/477).
Neither causes trouble: the resolver prefers the active row when a name matches both, and
nothing is filed under `Deals` any more.

### Every deal is a real saving

| Deal | À la carte | Deal | Saving |
|---|---|---|---|
| 2 Old & Gold Smashed | 2 × 999 = 1998 | 1899 | 99 |
| 2 Smashed Classic | 2 × 999 = 1998 | 1899 | 99 |
| 2 Qtr Chicken + Rice + Drinks | 2×699 + 2×299 + 2×130 = 2256 | 1499 | 757 |
| Any Two Classic Meals | 2 × 1449 = 2898 | 2199 | 699 |
| Any Two Meals from the Sea | 2 × 1749 = 3498 | 2599 | 899 |

The two Fireaway pizza deals are **not** in this table: the Classic and Signature pizza prices
were never pulled. Worth one check before going live:

```sql
SELECT c.name AS category, min(mi.base_price), max(mi.base_price), count(*)
FROM menu_items mi
JOIN menu_categories c ON c.id = mi.category_id
JOIN brands b ON b.id = mi.brand_id AND b.slug = 'fireaway'
WHERE mi.is_active AND c.name IN ('Classic','Signature')
GROUP BY c.name;
```

Add Rs 199 (Pepsi 1L) to each and compare against Rs 1499 / Rs 1599. It does not block the
run — the deals resolve either way.

Two older deals that looked like they would undercut these turned out to be retired:
Fireaway's `Deals` category is inactive (so **"Classic Lunch Feast Offer" Rs 999 is gone**) and
so is Wok & Go's (so **"Deal for 2" Rs 1999 is gone**).

---

## Route A — the script (recommended)

`backend/src/seed-lunch-deals-2026.ts`, wired up as `npm run seed:lunch-deals`.

It is non-destructive: it touches only the seven deals named in its `DEALS` config, upserts
the deal root **by name** (so re-running reprices in place and the item id survives, keeping
order history), and rebuilds only those deals' `deal_components`. It never deletes a menu item
or a category, and with `ATTACH_TO_BRANCHES = false` it writes nothing to `branch_menu_items`
at all, so no branch's price override or availability flag is touched.

Everything configurable lives in the `CONFIG` block at the top: the window, the days, the
channels, the deals category, branch attachment, the item and drink name lists, and the size
keys.

### Step 1 — dry run against production

```bash
cd backend
npm run seed:lunch-deals
```

The dry run performs every write inside a transaction and then **rolls back**, so it exercises
the real code path — constraints included — without leaving a trace. It prints the full plan:
which deals are `CREATE` vs `UPDATE`, and every slot resolved to real item ids.

If anything fails to resolve it writes nothing and tells you exactly what is wrong:

```
UNRESOLVED — nothing was written:
  ✗ Peperi Co: category "Deals" is AMBIGUOUS — 2 rows (ids 432, 477). Pin one with { id: <n> }
  ✗ Wok & Go: category "Lunch Deal" not found (needed by the deal roots)
  ? Wok & Go categories: Classic Meals · Drinks · From the Sea · Lunch Deal · Street Food
```

The `?` line lists the brand's real categories, which is usually enough to fix a name on the
spot. It also warns when a category is inactive, and when a slot pins a `sizeKey` that its
choices do not have — treat that one as a blocker, since it makes the slot unpickable at
order time.

**Read the plan and confirm the slot contents before continuing.**

### Step 2 — commit

```bash
npm run seed:lunch-deals -- --commit
```

Re-running is safe: the second run reports `UPDATE id <n>` instead of `CREATE` and rebuilds
the same slots.

### Step 3 — verify

```sql
SELECT mi.id, b.name AS brand, mi.name, mi.base_price,
       mi.available_time_start, mi.available_time_end, mi.available_days_of_week,
       count(dc.id) AS slots
FROM menu_items mi
JOIN brands b ON b.id = mi.brand_id
LEFT JOIN deal_components dc ON dc.menu_item_id = mi.id
WHERE mi.name IN (
  '2 Old & Gold Smashed Burgers', '2 Smashed Classic Burgers',
  '2 Quarter Chicken with Rice and Drinks',
  'Classic Pizza and 1L Drink Lunch Deal', 'Signature Pizza and 1L Drink Lunch Deal',
  'Any Two Classic Meals', 'Any Two Meals from the Sea')
GROUP BY mi.id, b.name ORDER BY b.name, mi.name;
```

Then check on POS **between 1pm and 5pm** — outside the window the deals are hidden by design,
so an empty deals tab at 11am is correct, not a bug.

### Undo

To withdraw a deal, deactivate it — do not delete it. `order_items.menu_item_id` is
`ON DELETE CASCADE`, so deleting a deal root silently deletes historical order lines.

```sql
UPDATE menu_items SET is_active = false
WHERE name IN ('2 Old & Gold Smashed Burgers' /* … */);
```

---

## Route B — the admin GUI

Possible, but it **cannot fully express four of the seven deals**. Use it for the three
Peperi Co deals; use the script for Fireaway and Wok & Go.

The GUI's deal form (`Admin → Deals`) saves only `slot_index`, `type`, `source_menu_item_id` /
`source_category_id` / `source_menu_item_ids`, `quantity` and `allow_customization`. It drops
`slot_size_key`, `slot_surcharges`, `allowed_size_keys` and the mirror fields. It also has no
time-window fields, so the lunch window must be set separately on the Menu Items page.

That means:

- **Fireaway** — both pizza deals pin `slot_size_key = '12'`. Not settable in the GUI. You can
  still hand-pick the Classic (or Signature) pizzas into a choice list, but the size pin is lost.
- **Wok & Go** — both deals pin `slot_size_key = 'large'`. Without it, a customer could pick
  a larger box inside a deal priced for Large.

### Steps, per deal

1. **Admin → Deals → + New deal.**
2. Pick the **brand**, and set **category** to **`Lunch Deal`**.
3. Enter the **deal name** and **deal price** from the table at the top.
4. **+ Add slot** for each line, then set its type:
   - *Fixed item* — for a specific product (e.g. `Old & Gold Smashed`). Add it **twice** as two
     separate slots rather than one slot with quantity 2, so the customer can customize each
     one independently.
   - *Choice from category* — for "any item from this range" (e.g. `Classic Meals`).
   - *Choice from list* — for a hand-picked set (e.g. the active 345ml drinks).
5. Leave **allow customization** on for food; turn it **off** for drink slots.
6. **Save.**
7. Go to **Admin → Menu Items**, find the deal you just created (it is a menu item in the deals
   category), **Edit**, and set:
   - *Available from* `13:00`
   - *Available to* `17:00`
   - *Days* — leave empty for every day.
8. Save. Confirm the deal appears on POS during the window.

Step 7 is the one people miss. Without it the deal sells all day.

---

## Files

- `backend/src/seed-lunch-deals-2026.ts` — the script; all config is in the `CONFIG` block at the top.
- `backend/package.json` — `seed:lunch-deals` script entry.
