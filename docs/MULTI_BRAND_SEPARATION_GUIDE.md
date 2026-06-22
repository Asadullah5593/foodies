# Multi-Brand Separation — Developer Guide (POS & Mobile)

**Date:** 12 June 2026 · **Backend branch:** `asad` · **Migration:** `1760000000018-BranchUserBrandLock`

Foodies is a single-location food court with four independent brands — **Lorenzo, Fireaway, Peperi Co, Wok & Go** — sharing one branch. This update separates the brands across every ordering channel:

- A till (POS user) can be **locked to one brand** and can only see/sell that brand's menu.
- KDS, FOH and customer screens only ever show **their own brand's orders** (enforced server-side).
- Mobile app and kiosk carts are **single-brand**: one cart, one checkout, one order per brand.
- **Consumer web is unchanged** — it may still mix brands in one cart (the backend splits it into one order per brand, as before).

No endpoints were added or removed and no request/response shapes were broken. All changes are **server-side enforcement + new optional fields**.

---

## 1. How the brand lock works

The lock lives on the user's branch assignment (`branch_users.brand_id`):

| Assignment | Meaning |
|---|---|
| `brand_id = 25` (e.g. Fireaway) | User is **brand-locked**: menu, orders, KDS/FOH/customer screens all scoped to Fireaway only |
| `brand_id = NULL` | No lock — user sees all brands at the branch (supervisors/managers) |
| User has `all-branches:access` permission | Never brand-locked, regardless of assignment |

Set it in **Admin → Branch Users → Assign Users**: when the selected branch has more than one brand, each user row shows a **Brand** dropdown (default "All brands").

Roles are unchanged — Cashier/Kitchen/Manager stay as they are. The *assignment* carries the brand, not the role.

---

## 2. Endpoints that changed

### 2.1 Auth

| Endpoint | Change |
|---|---|
| `POST /api/auth/login` `GET /api/auth/user` | The `user` object gains two fields:<br>`allowed_brand_ids: number[] \| null` — `null` = unrestricted, array = locked to these brands<br>`brand_id: number \| null` — convenience field, set when locked to exactly one brand |

```json
{ "user": { "id": 42, "name": "Fireaway Till 1", "allowed_brand_ids": [25], "brand_id": 25, "permissions": ["orders:create"] } }
```

### 2.2 POS

| Endpoint | Change |
|---|---|
| `GET /api/pos/menu?branch_id=X` | For brand-locked users: `menu[]` contains only the locked brand's items, `brands[]` contains only the locked brand. New field `locked_brand_ids: number[] \| null`. Unlocked users see everything, as before. |
| `POST /api/pos/orders/quote` | **403** if any item belongs to a brand outside the user's lock: `"This till can only sell items of its own brand."` |
| `POST /api/pos/orders` | Same 403 rule. Unlocked users (supervisors) can still create cross-brand orders (auto-split into one order per brand via `order_group_id`, unchanged). |
| `GET /api/pos/kiosk-orders/:code?branch_id=X` | Brand-locked cashier gets **404** for another brand's kiosk code (treated as not found — no data leak). Response now includes `brand_id`. |
| `POST /api/pos/kiosk-orders/:code/finalize` | Same 404 rule; the finalized order is also re-validated against the cashier's brand (so an edited cart can't smuggle foreign-brand items). |

### 2.3 Kitchen / FOH / Customer screen (all on `/api/kitchen/*`)

| Endpoint | Change |
|---|---|
| `GET /api/kitchen/orders?branch_id=X` | For brand-locked users the brand filter is **forced server-side** — omitting `brand_id` still returns only their brand's orders. Passing a `brand_id` outside their lock → **403**. Unlocked users keep the optional `brand_id` filter. |
| `GET /api/kitchen/orders/:id` `GET /api/kitchen/orders/:id/kot` | **404** if the order belongs to another brand. |
| `PATCH /api/kitchen/orders/:id/status` | **404** if the order belongs to another brand — one brand's kitchen staff cannot bump another brand's ticket. |

> Note for locked staff: orders with `brand_id = NULL` (legacy mixed-brand orders placed by a supervisor) are **not** visible to brand-locked users.

### 2.4 Kiosk (public)

| Endpoint | Change |
|---|---|
| `POST /api/public/kiosk/orders` | **400** if the cart mixes brands: `"Items from different brands cannot be combined in one order. Please place a separate order per brand."` The cart's brand is stored on the kiosk order. |

### 2.5 Consumer (mobile app + consumer web — shared endpoint)

| Endpoint | Change |
|---|---|
| `POST /api/public/consumer/orders` | Single-brand enforcement is **gated by the `x-client-platform` header**:<br>• header absent, or anything other than `web`/`consumer_web` → treated as `consumer_app` → mixed-brand cart **rejected with 400**<br>• `x-client-platform: web` (what consumer-web sends) → **unchanged**, mixed carts still allowed and split per brand |

### 2.6 Admin

| Endpoint | Change |
|---|---|
| `POST /api/admin/branches/:branchId/users` | `assignments[]` items accept an optional `brand_id` (`{ user_id, role_id, brand_id }`). Omit or `null` = no lock. |
| `GET /api/admin/branches/:branchId/users` `GET /api/admin/branches/all/users` | Rows now include `brand_id` and `brand_name`. |

### Unchanged

`/public/consumer/brands`, `/public/consumer/branches`, `/public/consumer/menu/*`, `/admin/orders/*` (manager oversight stays cross-brand), order splitting by `order_group_id`, payments, loyalty, invoices, rider/tracking.

---

## 3. Guide for the POS developer

Almost everything is **server-driven** — the React POS already adapts because the data arrives pre-filtered:

- **Till:** `GET /pos/menu` returns only the locked brand, so the brand dropdown auto-hides (`brands.length <= 1`) and the grid only shows own-brand tiles. No client filtering needed.
- **KDS / FOH / customer screen:** keep polling `GET /kitchen/orders` exactly as before. Locked users get only their brand even with no `brand_id` param; the brand filter dropdown will show just one option (its source, `/pos/menu` `brands[]`, is also filtered).
- **Things to handle in the client:**
  - `user.allowed_brand_ids` / `user.brand_id` are now in the login payload — use them if you want to show the brand name on screen or hide the brand filter explicitly.
  - Surface the **403 message from quote/order** ("This till can only sell items of its own brand") as a toast — it can occur if a stale cart line survives a brand change.
  - Kiosk code lookup returns **404 for foreign-brand codes** — show "Kiosk order not found" (the existing not-found handling already covers this).

---

## 4. Guide for the mobile developer

The API already supports everything you need; the work is **cart UX**:

1. **One cart per brand.** When the customer adds an item from brand B while the cart holds brand A items, create/switch to a separate brand-B cart (Foodpanda-style). Do **not** merge.
2. **One checkout per brand.** Each cart is submitted as its own `POST /public/consumer/orders` call → one payment, one order, one tracking flow per brand.
3. **Header:** keep sending whatever you send today (or nothing). Any value other than `web`/`consumer_web` is treated as the app. Do **not** send `x-client-platform: web` — that would opt you out of the enforcement.
4. **Handle the 400.** Older app versions that still submit mixed carts will receive:
   ```json
   { "statusCode": 400, "message": "Items from different brands cannot be combined in one order. Please place a separate order per brand." }
   ```
   Show this verbatim or map it to your own copy.
5. **Brand discovery is unchanged:** `GET /public/consumer/brands?branch_id=X` lists the brands; `GET /public/consumer/menu/items?branch_id=X&brand_id=Y` returns a brand's menu. Every menu item carries `brand_id` — use it to route the item into the right cart.

The kiosk app follows the identical rules via `POST /public/kiosk/orders` — one submission (and one collection code) per brand.

---

## 5. How to test

### Setup (once)

1. Run migrations (`npm run migration:run` in `backend/`, or just start the app — migrations run on boot).
2. In **Admin → Branch Users**, assign a test user to the food-court branch with role *Cashier* (or *Kitchen*) and **Brand = Fireaway**. Assign a second user with **Brand = All brands** (supervisor).

### POS / KDS checks (as the locked user)

| # | Step | Expected |
|---|---|---|
| 1 | `POST /api/auth/login` | `user.allowed_brand_ids = [<fireawayId>]`, `user.brand_id = <fireawayId>` |
| 2 | `GET /api/pos/menu?branch_id=<branch>` | Only Fireaway items; `brands` = `[Fireaway]`; `locked_brand_ids` set |
| 3 | `POST /api/pos/orders/quote` with another brand's `menu_item_id` | **403** "This till can only sell items of its own brand." |
| 4 | Same quote with a Fireaway item | **200/201** with totals |
| 5 | `GET /api/kitchen/orders?branch_id=<branch>` (no `brand_id`) | Only Fireaway orders |
| 6 | Same with `&brand_id=<otherBrand>` | **403** |
| 7 | `PATCH /api/kitchen/orders/<foreign-brand-order-id>/status` | **404** |
| 8 | Repeat 2 & 5 as the supervisor user | All brands visible |

### Kiosk checks

| # | Step | Expected |
|---|---|---|
| 1 | `POST /api/public/kiosk/orders` (header `x-kiosk-api-key`) with items from two brands | **400** mixed-brand message |
| 2 | Same with a single brand | **201** `{ kiosk_code, total }` |
| 3 | Locked cashier `GET /api/pos/kiosk-orders/<code>?branch_id=X` for an own-brand code | **200** with cart + `brand_id` |
| 4 | Same for another brand's code | **404** |

### Mobile / consumer checks

| # | Step | Expected |
|---|---|---|
| 1 | `POST /api/public/consumer/orders` with mixed-brand items, **no platform header** | **400** mixed-brand message |
| 2 | Same body with header `x-client-platform: web` | **201**, response contains one order per brand under the same `order_group_id` (consumer-web regression — must keep working) |
| 3 | Single-brand order, no header | **201**, one order |

### cURL snippets

```bash
B=https://<host>/api

# login → token + brand lock
curl -s $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"fireaway-till@example.com","password":"..."}'

# foreign-brand quote → expect 403
curl -s $B/pos/orders/quote -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"branch_id":10,"order_type":"takeaway","items":[{"menu_item_id":<OTHER_BRAND_ITEM>,"quantity":1}]}'

# KDS without brand param → only own brand returned
curl -s "$B/kitchen/orders?branch_id=10" -H "Authorization: Bearer $TOKEN"

# mobile mixed cart → expect 400
curl -s $B/public/consumer/orders -H 'Content-Type: application/json' \
  -d '{"branch_id":10,"order_type":"takeaway","customer_name":"T","customer_phone":"03001234567","items":[{"menu_item_id":<BRAND_A_ITEM>,"quantity":1},{"menu_item_id":<BRAND_B_ITEM>,"quantity":1}]}'
```

---

## 6. Error reference

| HTTP | Message | Where | Meaning |
|---|---|---|---|
| 403 | `This till can only sell items of its own brand.` | POS quote/order | Cart contains an item outside the user's brand lock |
| 403 | `You do not have access to this brand` | `/kitchen/orders?brand_id=` | Locked user requested another brand's queue |
| 400 | `Items from different brands cannot be combined in one order. Please place a separate order per brand.` | kiosk submit, consumer (app source) order | Mixed-brand cart on a single-brand channel |
| 404 | `Order not found` / `Kiosk order not found, already paid, or expired` | kitchen detail/status/KOT, kiosk lookup/finalize | Resource exists but belongs to another brand (intentionally indistinguishable from not-found) |
