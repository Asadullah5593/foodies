# Mobile App — Discounts, Promotions, Coupons, Campaigns & Banners API

**Audience:** mobile app developer.
**Scope:** everything the app must call to display offers/banners and apply discounts & vouchers.
All examples below are the **actual** request/response shapes from the backend.

---

## 0. IMPORTANT — offers are created in the admin panel FIRST

The mobile app **only reads and applies** offers. It never creates them. Every
discount, product promotion, coupon/voucher, deal and campaign/banner is created
by staff in the **Admin panel → "Discounts & Promotions"** (the same web app used
for POS). Nothing appears in the app until an admin creates it there.

The flow is:

1. **Admin** creates the offer (Discount / Product Promotion / Coupon) and, for
   coupons, **issues vouchers** to customers — see §9 for those admin endpoints
   (reference only; the app does not call them).
2. **Admin** builds a **Campaign** and adds **banner items** pointing at products,
   deals, categories, or offers.
3. **App** then: shows the campaign feed & banners, shows discounted menu prices,
   lists the customer's vouchers, and applies a voucher/coupon at checkout.

So: **if the app shows nothing, first confirm the admin created & activated the
offer/campaign and (for coupons) issued a voucher to that customer.**

---

## 1. Base URL, tenant, and auth

- **Base path:** `/public/consumer` (e.g. `https://api.foodies.../public/consumer/...`).
- **Tenant:** resolved **server-side from the `TENANT_ID` env** for menu/banners/
  campaigns/vouchers. The app does **not** send a tenant id. (Order/quote resolve
  the tenant from `branch_id`.)
- **Customer JWT:** obtained from login; sent as `Authorization: Bearer <token>`.

### 1.1 Login → get the JWT

`POST /public/consumer/auth/login`  (no auth)

```jsonc
// Request  (phone+password primary; email+password legacy)
{ "phone": "03001234567", "password": "secret123" }
```
```jsonc
// Response 201  — the token field is "token"
{
  "token": "<JWT>",
  "customer": { "id": 42, "tenant_id": 1, "phone": "03001234567", "name": "John Doe", "email": "john@example.com", "loyalty_points_balance": 120 }
}
```
Send it back on protected calls as `Authorization: Bearer <token>`.

**Endpoints that REQUIRE the customer token:** `GET /vouchers/mine`,
`GET /promotions`, `POST /promotions/:id/claim`, profile/ratings/location endpoints.
**Optional token** (links the order to the customer, enables loyalty):
`POST /orders/quote`, `POST /orders`.

### 1.2 `x-client-platform` header

Send `x-client-platform: consumer_app` on `/orders/quote`, `/orders`, `/orders`
(history). It's the default if omitted. Loyalty earn/redeem only applies for
`consumer_app` (and POS).

---

## 2. Menu with discount pricing

`GET /public/consumer/menu?branch_id=1`  (no auth)
Query: `branch_id` **required**; optional `brand_id`, `search`, `order_type`
(`delivery` | `pickup` | `dine_in`).

Each item now carries a **discount preview** (auto, code-free offers only;
time-boxed offers are excluded and applied at checkout instead):

```jsonc
{
  "id": 5,
  "name": "Zinger Burger",
  "image_url": "https://…",
  "price": 850,               // ← pre-discount price to strike through (there is NO "original_price" field)
  "base_price": 850,
  "discounted_price": 722.5,  // ← show this as the "now" price when discount_amount > 0
  "discount_amount": 127.5,
  "discount_percent": 15,
  "discount_label": "15% OFF",     // string or null
  "has_cart_level_offer": false,   // true → show a "more offers at checkout" hint
  "category": "Burgers", "category_id": 3, "brand_id": 12,
  "available_for_order_types": ["delivery","pickup","dine_in"],
  "available_now": true,
  "variants": [ { "id": 3, "name": "Large", "price_modifier": 100, "size_key": "L", "is_default": false } ],
  "addons": [ { "id": 1, "name": "Extra Cheese", "price": 80 } ],
  "modifier_groups": [ { "id": 9, "name": "Sauces", "min_select": 0, "max_select": 2, "modifiers": [] } ]
}
```

**Display rule:** if `discount_amount > 0`, show `price` struck through and
`discounted_price` as the active price (+ optional `discount_label` badge). If
`has_cart_level_offer` is true, add a small "more offers at checkout" hint (those
are whole-order / BOGO / min-order offers that only resolve in the cart).

**Channel targeting (server-side, nothing to send):** every offer can be
restricted by the admin to specific channels (`pos` / `app` / `web` / `kiosk`).
This endpoint previews the **app** channel, and quote/checkout enforce the same
rule from the order source — so a POS-only promotion never shows a discounted
price in the app nor applies at app checkout, and vice versa. Item detail
(`GET /public/consumer/menu/items/:id?branch_id=…`) carries the same preview
fields as of this change.

---

## 2.1 Deals — the item-detail `deal` object is pre-restricted for the app

When `GET /public/consumer/menu/items/:id?branch_id=…` returns an item that is a
deal, it includes a `deal` object with `slots[]`, each slot carrying
`choice_items[]`. **The server pre-applies the same restrictions POS enforces**,
so the app can render each slot's choices 1:1 without re-deriving deal rules. For
the `app` channel the payload is shaped so that:

1. **Variants are limited to the slot's size.** If a slot sets `slot_size_key`
   (e.g. `"5"`, `"12"`, `"large"`) each choice item's `variants[]` contains only
   that size; if it sets `allowed_size_keys` (e.g. a BOGO slot `["12","14"]`),
   only those sizes appear. A choice item that has no variant at the slot size
   (a non-size side sharing the slot) keeps its variants unchanged.
2. **Cross-sell groups are removed.** Any `modifier_group` the admin flagged
   `hide_in_deals` (e.g. "Add a drink", "Add a dip") is stripped — the deal's own
   slots already cover those. Groups that remain are the real in-deal options
   (base, flavour, dips-to-choose, etc.) and still carry `min_select`/`max_select`.
3. **`addons` is always empty** for a deal choice item — a fixed-price deal never
   charges à-la-carte add-ons.

**What the app must still do (not server-enforceable):**

- **Gate "Add to Cart"** on every required selection: a required slot
  (`optional: false`) must be filled to its `quantity`, and every visible
  modifier group with `min_select ≥ 1` must have at least `min_select` picked.
- **Honour `min_select`/`max_select`/`included_quantity`/`allow_quantity`** per
  group (show the "choose 2", counters, etc.).
- **Honour per-size fields** (`price_by_size`, `min_select_by_size`,
  `max_select_by_size`, modifier `available_for_sizes`) against the chosen size.
- **Mirror slots (BOGO):** slots with `mirror_slot_index` +
  `mirror_match_size` / `mirror_match_category` are resolved interactively — the
  2nd pick must match the 1st slot's chosen size/category. These fields stay in
  the payload for the app to enforce at selection time (same as POS).

> The `pos` channel deliberately receives the **unrestricted** shape (POS filters
> client-side); this restriction applies only to the consumer/`app` channel, so
> POS behaviour is unchanged.

---

## 3. Cart pricing (quote) — the authoritative "real / discounted / difference"

`POST /public/consumer/orders/quote`  (optional token, send `x-client-platform`)

```jsonc
// Request
{
  "branch_id": 1,
  "order_type": "delivery",
  "items": [
    { "menu_item_id": 5, "quantity": 2, "variant_id": 3,
      "addons": [{ "addon_id": 1, "quantity": 1 }],
      "modifiers": [{ "modifier_id": 7, "quantity": 1 }] }
  ],
  "discount_code": "SAVE10",          // a voucher/coupon code (see §5) — omit if none
  "customer_phone": "03001234567",    // enables per-customer voucher checks + loyalty
  "loyalty_points_to_redeem": 50,
  "payment_split": { "cash_amount": 0, "card_amount": 2000 },  // omit → cash GST rate
  "bank_card_id": 4,                  // for card-linked offers
  "latitude": 24.8607, "longitude": 67.0011,
  "delivery_tier": "standard"
}
```
```jsonc
// Response 200
{
  "subtotal": 1700,
  "auto_discount_amount": 100,     // = product_promo + order discount + card (non-coupon)
  "product_promo_amount": 0,
  "order_discount_amount": 100,
  "card_discount_amount": 0,
  "coupon_discount_amount": 170,
  "discount_amount": 270,          // grand total of all discount stages
  "discount_code": "SAVE10",       // or null if the code didn't apply
  "cap_applied": false,            // true if the per-order max-discount cap clamped it
  "loyalty_discount": 50,
  "loyalty_points_redeemed": 50,
  "tax_amount": 68, "tax_basis": "cash", "tax_rate_cash": 0.05, "tax_rate_card": 0.05,
  "service_charge": 0,
  "delivery_fee": 150,
  "delivery_options": [ { "tier": "standard", "fee": 150, "etaMin": 30, "etaMax": 45 } ],
  "total_amount": 1688,
  "line_breakdown": [
    { "menu_item_id": 5, "brand_id": 12,
      "subtotal": 1700, "original_subtotal": 1700,
      "discount_amount": 270, "after_discount": 1430, "is_deal": false }
  ]
}
```

**Cart display:** per line use `original_subtotal` (strike) → `after_discount`
(+ `discount_amount` saved). In the summary, show the stages that are > 0:
Product promos, Discount, Coupon (`discount_code`), Card offer, Loyalty — then
Tax, Delivery, Total. `is_deal: true` lines are never discounted (deal price is
fixed). If `discount_code` was sent but comes back `null`, the code was not
eligible (expired / limit reached / not targeted to this customer) — tell the user.

Note: HTTP **422** = delivery address outside the branch radius.

---

## 4. Placing the order

`POST /public/consumer/orders`  (optional token, `x-client-platform`)

```jsonc
// Request (offer-relevant fields shown; full order fields also apply)
{
  "branch_id": 1, "order_type": "delivery",
  "customer_name": "John Doe", "customer_phone": "03001234567",
  "delivery_address": "123 Main St", "latitude": 24.8607, "longitude": 67.0011,
  "items": [ { "menu_item_id": 5, "quantity": 2, "variant_id": 3, "addons": [{ "addon_id": 1, "quantity": 1 }] } ],
  "discount_code": "SAVE10",          // the applied voucher/coupon code
  "loyalty_points_to_redeem": 50,
  // MUST match what you sent to /quote, or the order re-prices without the card
  // offer and the customer is charged more than the screen promised.
  "payment_split": { "cash_amount": 0, "card_amount": 2000 },
  "bank_card_id": 4,
  "idempotency_key": "uuid-optional"  // send a UUID to dedupe double-taps
}
```
```jsonc
// Response 201 — order group (one order per brand); offer fields:
{
  "order_group_id": "grp_abc123",
  "orders": [
    { "id": 1001, "order_number": "R-1001", "status": "pending",
      "subtotal": 1700, "discount_amount": 270, "discount_code": "SAVE10",
      "tax_amount": 68, "delivery_fee": 150, "total_amount": 1688,
      "loyalty_points_redeemed": 50, "loyalty_points_balance": 70, "items": [ … ] }
  ]
}
```
The backend enforces the per-customer / global voucher limits **race-safely** at
order time and books the redemption. If the customer already hit the limit, the
coupon simply isn't applied (the order still succeeds at the undiscounted price —
re-quote to show the real total). **Cancelling an order automatically frees the
voucher** for re-use.

---

## 5. Vouchers (customer's coupons) — the app never shows a code

Coupons reach a customer as **vouchers**. The customer never sees or types a code;
they tap a voucher (or POS scans its QR). The app applies it by sending the
voucher's coupon `code` as `discount_code` in §3/§4 — obtain that code from §5.2.

### 5.1 List my vouchers

`GET /public/consumer/vouchers/mine`  (**token required**)

```jsonc
// Response 200
[
  { "id": 900,
    "reference": "VCH-900",       // human-readable serial (also shown at POS)
    "qr_token": "b2c1…",          // opaque — render THIS as the voucher's QR (not the code)
    "title": "Welcome Voucher", "type": "percentage", "value": 15,
    "min_order_amount": 500, "per_customer_limit": 1, "uses": 0,
    "expires_at": "2026-08-01T00:00:00.000Z" }
]
```
Render each as a card ("Welcome Voucher — 15% off, min Rs 500, expires …") **with a
QR generated from `qr_token`** (see §6). No coupon code is shown to the customer.
`uses` vs `per_customer_limit` tells you if it's spent. `reference` is the serial
staff see at POS.

> **Active-only + auto-issued vouchers.** This endpoint returns **only
> `status='active'`, non-expired** vouchers — spent/expired ones are filtered out
> server-side, so don't build a used/expired history from it. Vouchers are issued
> automatically by audience, no code needed:
> - **`all`-audience coupons** → a voucher is minted for **every** customer (all
>   existing ones the moment the coupon is created, and each new sign-up), so it
>   appears here for everyone.
> - **`new_customer` coupons** → a voucher is minted for a customer when they register.
>
> Because issuance happens server-side, **refresh `GET /vouchers/mine` right after
> signup / first login** (and after the app regains focus) so newly-issued vouchers
> show up immediately.

### 5.2 Resolve a voucher to an applyable code (tap-to-apply or QR scan)

`GET /public/consumer/vouchers/resolve?token=<qr_token>`  (no auth)

```jsonc
// Response 200
{ "valid": true, "voucher_id": 900, "code": "WELCOME15", "title": "Welcome Voucher" }
```
- **In-app "Apply":** resolve the voucher's token → take `code` → send it as
  `discount_code` in quote/order. If `valid: false`, the voucher is expired/used.
- **POS QR scan:** the app renders the voucher's `qr_token` as a QR on the voucher
  card (see §6); POS scans it and resolves the same way.

---

## 6. QR rendering (app responsibility)

Each voucher in `/vouchers/mine` now carries its **opaque `qr_token`** (not the
coupon code). The app renders that token as a QR image (any client QR library) on
the voucher card so in-store POS can scan it. Leak-safe: even a photographed QR
can't be over-redeemed — the voucher is bound to the customer and limits are
enforced server-side. POS scans the QR → calls `/vouchers/resolve?token=` → gets
the code to apply.

---

## 7. Campaigns & banners feed (home carousel)

`GET /public/consumer/campaigns/feed?limit=50&offset=0`  (no auth)
Returns only active, in-window campaigns that have ≥1 active in-window item.

```jsonc
// Response 200
[
  {
    "id": 7, "name": "Summer Deals", "image_url": "https://…",
    "items": [
      { "id": 31, "kind": "offer",            // offer | deal | info
        "title": "15% Off Burgers", "subtitle": "This weekend only",
        "image_url": "https://…",
        "destination_type": "deal",           // product|deal|category|brand|branch|none
        "destination_id": 5,
        "deep_link_url": "https://app.foodies-pakistan.com/promo/31" }
    ]
  }
]
```

> **Image note:** the campaign-level `image_url` is usually **null** — banner
> images live on each **item** (`items[].image_url`). Render the item images; use
> the campaign `name` only as an optional section heading.

Render each campaign's `items` as a banner/carousel. **Tap handling by
`destination_type`:**

| destination_type | Navigate to |
|---|---|
| `product` | menu item detail (`destination_id`) |
| `deal` | that deal (`destination_id`) |
| `category` | menu filtered to category `destination_id` |
| `brand` / `branch` | that brand/branch menu |
| `none` (or `deep_link_url` null) | **view-only** banner — not tappable |

### 7.1 Resolve a deep link (cold start from a shared link)

Deep links are `https://app.foodies-pakistan.com/promo/{itemId}`. On open, call:

`GET /public/consumer/campaigns/items/:id`  (no auth) → returns the same item
object (with `destination_type` + `destination_id`) so you can route.

### 7.2 Legacy banners endpoint (still available)

`GET /public/consumer/banners` returns the older CMS banners
(`title, subtitle, image_url, link_url, valid_from, valid_until, …`). Prefer the
campaigns feed; use this only if you already integrated it.

---

## 8. End-to-end flows

**Browse → buy discounted item:** `GET /menu` → show `discounted_price` → add to
cart → `POST /orders/quote` (see stacked breakdown) → `POST /orders`.

**Apply a voucher:** `GET /vouchers/mine` → user taps one → `GET /vouchers/resolve`
→ put `code` into `discount_code` on quote+order.

**Tap a banner:** `GET /campaigns/feed` → tap item → route by `destination_type`
(or open `deep_link_url`, then `GET /campaigns/items/:id` to route).

---

## 9. Admin creation endpoints (REFERENCE ONLY — the app does not call these)

For context on how offers get created (admin/POS web app; `Authorization: Bearer
<admin JWT>` + `Content-Type: application/json`):

| Offer | Endpoint | Notes |
|---|---|---|
| **Discount** (auto, order/category/brand/branch) | `POST /admin/discounts` | send `requires_code:false`; `offer_kind` auto-derived |
| **Product Promotion** (per product) | `POST /admin/product-promotions` | `application_scope_ids` = menu item ids |
| **Coupon** | `POST /admin/coupons` | `audience: 'all'\|'specific'\|'new_customer'`, `per_customer_limit`, `voucher_validity_days` |
| **Issue vouchers** | `POST /admin/coupons/:id/issue-vouchers` | body `{ "customer_ids": [12,34] }` → `{ "issued":2, "existing":1 }` |
| **Coupon report** | `GET /admin/coupons/:id/report` | redemptions + value |
| **Campaign** | `POST /admin/campaigns` | umbrella |
| **Campaign item (banner)** | `POST /admin/campaigns/:id/items` | `kind:'offer'\|'deal'\|'info'`; `deep_link_url` auto-generated |
| **Campaign report** | `GET /admin/campaigns/:id/report` | merchant vs bank-funded split |
| **Bank card + its offer** | `POST /admin/bank-cards` | the card owns its discount — see below |
| **Offer settings** (stacking/caps) | `GET`/`PUT /admin/offer-settings` | tenant-wide engine knobs |

### Bank card offers

A bank card discount is **not** a discount row and is not created on the Discounts
page. The card carries its own offer: `discount_type` (`flat`|`percentage`),
`discount_value`, `min_order_amount`, `max_discount_amount`, plus the same
`valid_from`/`valid_until`/`valid_time_start`/`valid_time_end`/`valid_days_of_week`
window every other offer module has. A null `discount_value` means the card exists
only for tender/BIN capture and discounts nothing (`has_offer: false` in responses).

Card offers are always **whole-order** and always **bank-funded** (exempt from the
merchant discount cap unless `capIncludesCardOffers` is on). They apply only when
the **entire bill** is tendered on that card — `payment_split.card_amount > 0` with
`cash_amount <= 0`, plus `bank_card_id` — so a cash+card split earns nothing.
They stack last, after product promotions, discounts and coupons.

#### Customer-facing card endpoints (no auth)

| Endpoint | Purpose |
|---|---|
| `GET /public/consumer/bank-cards?branch_id=1[&brand_id=2]` | Cards with a live offer. Only cards that discount something are listed; each carries its terms and `bin_prefixes`. |
| `GET /public/consumer/bank-cards/detect?branch_id=1&bin=401234[&brand_id=2]` | Which offer card a number belongs to → `{ bin, matched, card }`. Longest matching BIN wins. |

**Send only the first 6–8 digits to `/detect` — never a full card number.** The
server truncates to 8 digits defensively, but a PAN must not leave the device.
Neither endpoint exposes brand/branch targeting.

Typical app flow: list the offers to advertise them → customer enters their card →
send the BIN to `/detect` → pass the returned `card.id` as `bank_card_id` to
`/quote` **and** to order placement, with `payment_split` showing the full bill on
card.

```jsonc
// GET /public/consumer/bank-cards/detect?branch_id=1&bin=401234
{
  "bin": "401234",
  "matched": true,
  "card": {
    "id": 5, "name": "Bank Al Habib", "bank": "BAHL", "network": "Mastercard",
    "bin_prefixes": ["401234", "5321"],
    "discount_type": "percentage", "discount_value": 25,
    "min_order_amount": 100, "max_discount_amount": 1000,
    "valid_from": "2026-07-15T00:00:00.000Z", "valid_until": "2026-07-16T00:00:00.000Z",
    "valid_time_start": null, "valid_time_end": null, "valid_days_of_week": [0, 2, 3],
    "requires_full_card_payment": true
  }
}
```

### Brand scoping on the admin surfaces

Every offer surface above accepts `eligibility_brand_ids` (null/omitted = all brands) and returns
two read-only fields the admin UI renders from:

| Field | Meaning |
|---|---|
| `effective_brand_ids` | Brands the offer actually serves. When `eligibility_brand_ids` is unset, this is **derived from the brands owning `application_scope_ids`** — a promo on Fireaway products is a Fireaway offer. `null` = every brand. |
| `manage_scope` | `'full'` (caller owns every brand it serves — edit/delete freely), `'detach'` (also serves other brands — `DELETE` only removes the caller's brand and the offer survives), `'read_only'` (another brand's offer). |

Consequences for a brand-locked admin (`branch_users.brand_id` set):
- Omitting `eligibility_brand_ids` on create stamps their own brands.
- `DELETE` on a shared/all-brand offer **detaches** rather than deletes, responding
  `{ "detached": true, "eligibility_brand_ids": [...] }`. The row is deleted only when their brand
  was the last one on it.

None of this affects consumer/app pricing — `eligibility_brand_ids` already meant "any brand" when
null at quote time, and derivation only pins an offer to the brands it could already reach.

Example — create a new-customer coupon then issue a voucher:
```jsonc
// POST /admin/coupons
{ "name": "Welcome 100", "type": "flat", "value": 100, "min_order_amount": 500,
  "audience": "new_customer", "per_customer_limit": 1, "voucher_validity_days": 30 }
// POST /admin/coupons/55/issue-vouchers
{ "customer_ids": [12, 34, 56] }   // → { "issued": 3, "existing": 0 }
```
`new_customer` coupons also auto-issue a voucher when a customer registers, so
they show up in that customer's `GET /vouchers/mine` automatically.

---

### Quick reference — mobile endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/public/consumer/auth/login` | — |
| GET | `/public/consumer/menu?branch_id=` | — |
| POST | `/public/consumer/orders/quote` | optional |
| POST | `/public/consumer/orders` | optional |
| GET | `/public/consumer/campaigns/feed` | — |
| GET | `/public/consumer/campaigns/items/:id` | — |
| GET | `/public/consumer/vouchers/mine` | **Bearer** |
| GET | `/public/consumer/vouchers/resolve?token=` | — |
| GET | `/public/consumer/banners` | — |

---

## Invoice payload (order receipt) — new fields

The order-invoice payloads (`GET /pos/orders/:id/invoice` and `GET /pos/orders/group/:groupId/main-invoice`) were **extended** — all additive, nothing renamed. Any client rendering a receipt can now honour the tenant's configured invoice template.

Each order in the payload now also carries the **discount breakdown** (they sum to the existing combined `discount_amount`; populated for orders placed after this change, `0` on older orders):

```jsonc
{
  "discount_amount": 96,           // combined (unchanged)
  "promo_discount_amount": 70,     // ← product-promotion stage
  "order_discount_amount": 0,      // ← order-discount stage
  "coupon_discount_amount": 26,    // ← coupon stage
  "card_discount_amount": 0,       // ← bank-card stage
  "discount_code": "SAVE10",
  "tax_rate": 0.15,                // ← fraction; multiply by 100 for the % label
  "tax_basis": "cash",
  "brand_logo_url": "https://…",   // ← per-brand logo
  "order_type": "dine_in", "table_number": "7", "placed_at": "…",
  "customer_name": "…", "customer_phone": "…", "cashier_name": "…",
  "payment_method": "cash",        // ← distinct completed tenders, "cash + card" for split; null if untendered
  "invoice_number": "FDS-A7K2M9QX"  // ← permanent globally-unique ref; shown beneath order_number
}
```

`order_number` is the short daily call-out number ("014"); `invoice_number` is the order's permanent globally-unique reference (`FDS-XXXXXXXX` — 8 crypto-random uppercase alphanumeric chars, never reused; orders placed before the format change keep their legacy `BR-{brand}-{branch}-{date}-{seq}` value) and is rendered directly beneath the order number on every template. Treat it as an opaque string — never parse brand/branch/date out of it.

Group/single invoice root now also returns:
- `currency` — tenant currency code (format the symbol client-side).
- `header` — `{ legal_name, tenant_name, branch_name, address, phone, email }`.
- `template` — the **resolved active invoice template**: `{ id, layout, config: { …field toggles… } }`. `layout` is one of `"bill_bordered"` (dine-in bill, bordered Item/Qty/Rate/Amount table), `"receipt_logo"` (logo-forward counter receipt with a big Order # band), `"thermal_modern"` (clean minimal), `"thermal_classic"` (monospace), `"thermal_58mm"` (narrow roll) or `"a4_invoice"` (full page) — all but A4 are thermal-roll widths. Header details (order no, date, cashier, payment, customer) render as a two-column label/value table in every layout. The `config` booleans (e.g. `showCategory`, `showTax`, `showPromoDiscount`, `showPaymentMethod`, `showInvoiceNumber`, `showPoweredBy`) tell the client which fields to render; resolution is brand-default → tenant-default → built-in default, so `template` is always present. `config` also has three numeric/style keys: `fontScalePct` (whole-receipt font scale, 50–200), `poweredByFontPct` (size of the "powered by" line, 50–200) and `poweredByBold` (boolean). There is **no** `logoUrl` or `taxLabel` key — each order's own brand logo always prints (the platform logo is used only when a brand has none) and the tax label is fixed. The business header shows only the logo, brand/business name and the admin's free-text `headerText` (branch address/phone are NOT auto-filled); the order note renders below the line items, never in the top meta block. For a native renderer, mirror `frontend/src/invoices/renderInvoice.ts`.

Admin manage the templates via `GET/POST/PUT/DELETE /admin/invoice-templates` (+ `PUT /admin/invoice-templates/:id/activate`, `GET /admin/invoice-templates/active?brand_id=`). See `backend/src/invoices/invoice-template-config.ts` for the full config contract.

## FBR fiscal invoice number (order + invoice payloads) — new fields

Orders placed from **POS, the consumer app and kiosk** are reported to Pakistan's FBR at placement (per-branch setting; consumer-web checkout is exempt). Two additive fields now appear on the order payloads the app already consumes — the create-order response (`POST /public/consumer/orders`), the order-detail/group reads, and both invoice payloads (`GET /pos/orders/:id/invoice`, `GET /pos/orders/group/:groupId/main-invoice`):

```jsonc
{
  "fbr_invoice_number": "515011DDD1287011250929", // fiscal number to print/show; null when the branch has never had FBR active
  "fbr_number_source": "fbr"                      // "fbr" = FBR issued it for THIS order; "fallback" = branch's last real number reused (FBR off/unreachable); null = none
}
```

Client rendering rules:
- If `fbr_invoice_number` is null → render no FBR section at all.
- Otherwise show **"FBR Invoice #"** + the number, and a QR encoding **exactly the `fbr_invoice_number` string** (customers verify it in FBR's Tax Asaan app). On the printed receipt the QR sits bottom-right below the app-download QR, with the FBR logo bottom-left.
- Render `"fallback"` numbers identically to `"fbr"` ones — the source distinction is for reporting only, never shown to the customer.
- The invoice template `config` gained a `showFbrInvoice` boolean (default `true`); honour it like the other toggles. The block renders only when the toggle is on AND the number is non-null.
