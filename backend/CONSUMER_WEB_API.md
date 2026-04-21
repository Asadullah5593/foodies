# Consumer Web API Contract

Base URL: `/api/public/consumer`

This document is the website-focused contract (consumer web), aligned with backend behavior.

## Request headers

- `x-client-platform: web` (recommended)
  - `POST /orders` will store `source = consumer_web`
  - `GET /orders` will return `consumer_web` orders for that customer phone

If this header is missing, APIs default to mobile-compatible source behavior (`consumer_app`) for orders.

## Identity requirement

Cart APIs require `phone + branch_id` and the phone must belong to an existing customer.
If the customer does not exist, backend returns:

```json
{ "message": "Customer not found. Please login or register before using cart." }
```

Recommended web flow: require register/login before server-side cart calls.

## Discovery

- `GET /branches?latitude={lat}&longitude={lng}&radius_km={km}`
- `GET /brands?branch_id={branchId}`
- `GET /menu?branch_id={branchId}&brand_id={brandId}&search={term}`
- `GET /menu/items/{menuItemId}?branch_id={branchId}`

Menu item detail includes `variants`, `addons`, `modifier_groups`, and optional `deal` slots.

## Auth

- `POST /register`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/forgot-password`
- `POST /auth/verify-otp`
- `GET /profile/me` (Bearer token)
- `POST /profile/avatar` (Bearer token, multipart)

## Cart

### Get cart

- `GET /cart?phone={phone}&branch_id={branchId}`

### Add cart item

- `POST /cart/items`
- Body:

```json
{
  "phone": "03001234567",
  "branch_id": 1,
  "menu_item_id": 5,
  "quantity": 2,
  "variant_id": 3,
  "addons": [{ "addon_id": 1, "quantity": 1 }],
  "modifiers": [{ "modifier_id": 7, "quantity": 1 }],
  "notes": "No onions"
}
```

### Update cart item

- `PATCH /cart/items/{cartItemId}?phone={phone}&branch_id={branchId}`
- Body (any subset):

```json
{
  "quantity": 3,
  "variant_id": 2,
  "addons": [{ "addon_id": 1, "quantity": 1 }],
  "modifiers": [{ "modifier_id": 7, "quantity": 1 }],
  "notes": "Less spicy"
}
```

- `quantity: 0` removes the line.

### Remove / clear cart

- `DELETE /cart/items/{cartItemId}?phone={phone}&branch_id={branchId}`
- `DELETE /cart?phone={phone}&branch_id={branchId}`

## Orders

### Place order (consumer web)

- `POST /orders`
- Header: `x-client-platform: web`
- Body:

```json
{
  "branch_id": 1,
  "order_type": "delivery",
  "customer_name": "John Doe",
  "customer_phone": "03001234567",
  "customer_id": 42,
  "delivery_address": "123 Main St",
  "latitude": 24.8607,
  "longitude": 67.0011,
  "items": [
    {
      "menu_item_id": 5,
      "quantity": 2,
      "variant_id": 3,
      "addons": [{ "addon_id": 1, "quantity": 1 }],
      "modifiers": [{ "modifier_id": 7, "quantity": 1 }],
      "notes": "No onions"
    }
  ],
  "notes": "",
  "discount_code": "SAVE10",
  "loyalty_points_to_redeem": 50
}
```

Notes:
- `modifiers` are accepted in order items.
- `loyalty_points_to_redeem` is applied for **`consumer_web`** and **`consumer_app`** when `customer_phone` is present and redeem preview allows it.
- `customer_id` is optional; if sent, it must match `customer_phone` for the same tenant.
- `latitude` / `longitude` are optional and stored on the order.
- Payment is not taken here; use `POST /orders/{orderId}/pay` with `phone` and `payment_method`.
- Discount/coupon rules still follow existing backend eligibility rules.

### Order history / detail / status

- `GET /orders?phone={phone}&branch_id={branchId?}&tenant_id={tenantId?}&limit={n?}`
  - with `x-client-platform: web`, this returns `consumer_web` orders for the customer
  - each order item includes `loyalty_points_balance` (remaining balance) and `loyalty_points_redeemed` (points used in that order)
- `GET /orders/{orderId}?phone={phone}`
- `GET /orders/{orderId}/status`
- `PATCH /orders/{orderId}/cancel` with body `{ "phone": "03001234567" }`

## Payments

- `POST /orders/{orderId}/pay`

```json
{
  "phone": "03001234567",
  "payment_method": "cash",
  "amount": 2500,
  "reference_number": "REF123"
}
```

- `GET /orders/{orderId}/payments?phone={phone}`

Online gateway integration is separate; current API supports recording payments by method and amount.

## Loyalty

- `GET /loyalty/balance?branch_id={branchId}&phone={phone}`

## POS + Kitchen visibility

- Website orders are created through the same orders pipeline and are visible in POS/kitchen queues.
- Source is stored as `consumer_web` (when `x-client-platform: web`).
- Kitchen payloads include `source`, enabling UI badges like `consumer_web`.

## Error semantics

- `400`: invalid payload, missing required fields, invalid phone format, etc.
- `404`: missing resources (branch/customer/order/etc.).
- `409`: conflict cases (e.g., unique email where applicable).

