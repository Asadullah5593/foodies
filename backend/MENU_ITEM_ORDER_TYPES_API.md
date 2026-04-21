# Menu item order channels (delivery / pickup / dine-in)

This document describes how menu items are **scoped to order channels**, how **request `order_type` values** map to stored channels, and **which APIs** gained fields or behavior.

## Concepts

### Canonical channels (stored in DB)

Each menu item has an optional column `available_for_order_types` (`jsonb` array). Allowed values:

| Value       | Meaning |
|------------|---------|
| `delivery` | Item may appear on delivery orders. |
| `pickup`   | Pickup / takeaway orders (see mapping below). |
| `dine_in`  | Dine-in / table service (POS). |

- **Omit the column or use `null`** (legacy rows): the item is treated as available on **all three** channels (backward compatible).
- **Explicit list** (e.g. `["dine_in"]`): the item is **only** orderable for those channels.

### Request `order_type` → channel mapping

Clients send different strings for “takeaway” vs “pickup”. The backend **normalizes** before checking availability:

| Client `order_type` | Maps to channel |
|---------------------|-----------------|
| `delivery`          | `delivery` |
| `pickup`            | `pickup` |
| `takeaway`          | `pickup` (POS label; same as pickup) |
| `dine_in`           | `dine_in` |

Validation is case-insensitive on the normalized value.

### Enforcement

- **Placing or quoting an order** (`POST` orders, quote): if any line’s menu item does not support the order’s channel, the API returns **400** with a message naming the item and allowed channels.
- **Deal orders**: the **deal root** menu item and **each component** menu item must support the channel.

---

## Database

| Table        | Column                         | Type   | Notes |
|-------------|---------------------------------|--------|-------|
| `menu_items` | `available_for_order_types`    | `jsonb` | `null` = all channels; else array of `delivery`, `pickup`, `dine_in`. |

Run migrations so this column exists (see `1740000000041-MenuItemAvailableOrderTypes.ts`).

---

## Admin APIs (tenant / menu management)

### `POST /api/admin/menu/items`

**New optional body field**

- `available_for_order_types` (array of strings, optional): subset of `delivery`, `pickup`, `dine_in`.  
  - **Omitted or `null`**: all channels (stored as `NULL` in DB).  
  - **Provided**: must include **at least one** valid channel (invalid entries are ignored; if nothing valid remains → **400**).

Swagger: operation summary and `@ApiBody` schema updated on the controller.

### `PUT /api/admin/menu/items/:id`

**New optional body field**

- `available_for_order_types` (array or `null`):  
  - **`null`**: reset to “all channels” (DB `NULL`).  
  - **Array**: replace with validated list (at least one channel).  
  - **Omit field**: leave unchanged.

### `GET /api/admin/menu/items` (and related list responses)

Each item includes:

- `available_for_order_types`: **effective** list (always non-empty), e.g. `["delivery","pickup","dine_in"]` when DB is `null`.

### Deals admin list

`GET` deals list items now also expose `available_for_order_types` for each deal menu item row (same effective list).

---

## Consumer public API (`/api/public/consumer`)

### `GET /api/public/consumer/menu?branch_id=&…`

**New optional query**

- `order_type` (optional): when set, the response **only includes** items that support that channel (same mapping as orders: `takeaway` → `pickup`).

**Response (each item)**

- `available_for_order_types`: effective list so clients can filter client-side when `order_type` is omitted.

### `GET /api/public/consumer/menu/items/:id?branch_id=&…`

**New optional query**

- `order_type` (optional): if the item is **not** available for that channel → **404** (`Menu item not found`).

**Response**

- `available_for_order_types` on the item payload.

**Deal payloads**

- `GET` deal structure (`deal` key when the item is a deal): slot `choice_items` are **filtered** when `order_type` is passed, so choices incompatible with the channel are removed.

### `POST /api/public/consumer/orders`

**Body**

- `order_type` (required): must align with each line item’s availability (see enforcement above).

Swagger: `order_type` property documents allowed values and link to menu channel rules.

---

## POS API (`/api/pos`)

### `GET /api/pos/menu?branch_id=&order_type=`

**New optional query**

- `order_type`: same filtering behavior as consumer branch menu.

### `GET /api/pos/deal/:menuItemId?branch_id=&order_type=`

**New optional query**

- `order_type`: filters `choice_items` in each deal slot to items allowed for that channel.

---

## Orders / quote (all clients)

### Create order & quote

Any endpoint that builds order lines from `menu_item_id` / deal components now **asserts** channel compatibility using the same rules as above.

---

## Migration & defaults

- Existing rows with `NULL` **available_for_order_types** behave as **all channels**.
- New items created **without** `available_for_order_types` in the admin body also default to **all channels** (`NULL` in DB).

---

## Client checklist

1. **Menu browsing**: pass `order_type` on `GET` menu when the user has already chosen delivery vs pickup vs dine-in, or filter using `available_for_order_types` on each item.
2. **Item detail**: pass the same `order_type` on `GET` menu item detail to avoid showing items the user cannot order.
3. **Checkout**: `POST` orders with the same `order_type` used when browsing; handle **400** if the cart contains a restricted item.
4. **POS**: use `takeaway` or `pickup` consistently; both map to the `pickup` channel for menu rules.
