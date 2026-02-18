# Menu ownership: Tenant vs Brand vs Branch

## Design principle

In a multi-tenant restaurant system with multiple **brands** and **branches** (many-to-many), **POS**, **KOT**, **apps**, and **reporting**:

- **Menu items, variants, and addons** should be linked to the **brand** as their primary owner.
- **Brand** = food concept; it should have a **consistent core menu** across all branches where it operates.
- **Branches** control **how** those items are sold via **branch-level mappings**: price overrides, availability, and visibility.
- **Tenant** = top-level container for ownership and data separation only.

**In short:**

| Level   | Role |
|--------|------|
| **Tenant** | Top-level container; ownership and data separation. |
| **Brand**  | Defines **what** the item is (core menu: categories, items, variants, addons). |
| **Branch** | Defines **how** it is sold (price override, availability, visibility per branch). |

This avoids duplicating menus per branch, keeps brand-level reporting clean, and still lets each branch operate differently by location.

---

## Target data model

- **menu_categories**, **menu_items**, **menu_addons** (and **menu_variants** via menu_item): owned by **brand** (`brand_id`). One canonical menu per brand.
- **branch_menu_items**: mapping (branch + brand’s menu_item) with **price_override**, **is_available**, and optional visibility. No per-branch copies of the item; the branch just references the brand’s item and overrides.
- **Tenant** is derived from brand when needed (brand → tenant) for access control; menu entities do not need a direct `tenant_id` if they have `brand_id`.

---

## Implemented state

The codebase has been refactored to match this design:

- **menu_categories**, **menu_items**, **menu_addons** are **brand-scoped** (`brand_id`). No `tenant_id` on these tables; tenant is derived via brand.
- **menu_variants** belong to a menu_item (and thus to that item’s brand); no separate ownership.
- **branch_menu_items** is a mapping-only table: `branch_id`, `menu_item_id` (FK to brand-owned item), `price_override`, `is_available`, `is_hidden_online`. No `source_menu_item_id`; no copy-on-link.
- Menu APIs: list/create/update categories, items, addons, variants by **brand_id**. Branch menu API returns brand menu with branch-level overrides (price, availability, visibility) from branch_menu_items.
- Migration `1740000000012-MenuOwnershipToBrand` adds `brand_id`, backfills from tenant, removes branch copies and tenant/copy columns.
