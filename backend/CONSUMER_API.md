# Consumer API Reference

Base URL: **`/api/public/consumer`**

All endpoints are prefixed with the base URL. Example: `GET /api/public/consumer/brands`.

### Source routing for mobile vs web

`POST /orders` and `GET /orders` read optional header **`x-client-platform`**:

- `web` or `consumer_web` -> order source is stored/read as `consumer_web`
- any other value (or missing header) -> defaults to `consumer_app` (mobile-compatible behavior)

### Sending the customer JWT (profile/me, profile/avatar)

Endpoints that require auth expect the **Bearer token** in the **Authorization** header:

- **Header name:** `Authorization`
- **Header value:** `Bearer <token>` (the word "Bearer", a space, then the token from login)

Example (replace with your token from `POST .../auth/login`):

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

In Postman: use the **Authorization** tab, set Type to **Bearer Token**, and paste the token in the Token field (Postman adds "Bearer " for you).

---

## Brands

### List brands
- **Endpoint:** `GET /api/public/consumer/brands`
- **Auth:** None
- **Query:** `branch_id` (optional) – return only brands at this branch; `search` (optional) – filter by brand name (case-insensitive).
- **Response (200):** Array of brands (e.g. `id`, `name`, `tenant_id`, etc.)

### Get brand by ID
- **Endpoint:** `GET /api/public/consumer/brands/:id`
- **Auth:** None
- **Params:** `id` – brand ID
- **Response (200):** Brand object

---

## Branches

### List branches
- **Endpoint:** `GET /api/public/consumer/branches`
- **Auth:** None
- **Query:** `brand_id` (optional) – filter by brand
- **Response (200):** Array of branches

---

## Auth (customer)

### Register
- **Endpoint:** `POST /api/public/consumer/register`
- **Auth:** None
- **Body:**
```json
{
  "brand_id": 1,
  "branch_id": 2,
  "phone": "+1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "password": "secret"
}
```
- **Note:** Provide **either** `brand_id` or `branch_id` (not both required; one is required).
- **Response (201):**
```json
{
  "id": 1,
  "tenant_id": 1,
  "phone": "+1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "loyalty_points_balance": 0
}
```

### Login
- **Endpoint:** `POST /api/public/consumer/auth/login`
- **Auth:** None
- **Body:**
```json
{
  "email": "john@example.com",
  "password": "secret"
}
```
- **Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "customer": {
    "id": 1,
    "tenant_id": 1,
    "phone": "+1234567890",
    "name": "John Doe",
    "email": "john@example.com",
    "loyalty_points_balance": 0
  }
}
```

### Logout
- **Endpoint:** `POST /api/public/consumer/auth/logout`
- **Auth:** Optional (stateless; client discards token)
- **Body:** None
- **Response (200):** `{ "message": "Logged out successfully" }`

### Forgot password
- **Endpoint:** `POST /api/public/consumer/auth/forgot-password`
- **Auth:** None
- **Body:**
```json
{
  "email": "john@example.com"
}
```
- **Response (200):** `{ "message": "If an account exists, a code was sent to your email" }`
- **Note:** If no customer exists for the email, same message is returned (no leak). OTP is sent only when the customer exists and mail is configured (e.g. Mailtrap with `MAIL_PORT=2525`).

### Verify OTP (password reset)
- **Endpoint:** `POST /api/public/consumer/auth/verify-otp`
- **Auth:** None
- **Body:**
```json
{
  "email": "john@example.com",
  "code": "123456",
  "new_password": "newSecret"
}
```
- **Response (200):** `{ "message": "OTP verified successfully" }`
- **Note:** `new_password` is optional; if provided, customer password is updated.

---

## Profile (JWT-protected)

### Get my profile (JWT)
- **Endpoint:** `GET /api/public/consumer/profile/me`
- **Auth:** Bearer token (customer JWT from login)
- **Response (200):**
```json
{
  "id": 1,
  "tenant_id": 1,
  "phone": "+1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "loyalty_points_balance": 0,
  "profile_image_url": "/api/admin/upload/file/abc123.png"
}
```

### Upload profile avatar
- **Endpoint:** `POST /api/public/consumer/profile/avatar`
- **Auth:** Bearer token (customer JWT)
- **Body:** `multipart/form-data` with field `file` (image: png, jpeg, jpg, gif, webp, svg)
- **Response (200):** `{ "url": "/api/admin/upload/file/abc123.png" }`

---

## Profile (phone + branch)

### Get profile by phone
- **Endpoint:** `GET /api/public/consumer/profile`
- **Auth:** None
- **Query:** `phone`, `branch_id`
- **Response (200):**
```json
{
  "id": 1,
  "tenant_id": 1,
  "phone": "+1234567890",
  "name": "John Doe",
  "loyalty_points_balance": 0,
  "profile_image_url": "/api/admin/upload/file/abc123.png"
}
```

### Update profile
- **Endpoint:** `PATCH /api/public/consumer/profile`
- **Auth:** None
- **Body:**
```json
{
  "phone": "+1234567890",
  "branch_id": 1,
  "name": "John Doe",
  "email": "john@example.com"
}
```
- **Response (200):** Same shape as get profile (updated customer).

---

## Menu & categories

### Get menu (by branch)
- **Endpoint:** `GET /api/public/consumer/menu`
- **Auth:** None
- **Query:** `branch_id` (required); `brand_id` (optional) – filter by brand; `search` (optional) – filter menu items by name, description or category (case-insensitive).
- **Response (200):** Branch menu (categories and items).

### Get categories
- **Endpoint:** `GET /api/public/consumer/categories`
- **Auth:** None
- **Query:** `brand_id` (required)
- **Response (200):** Array of categories.

### Get menu item detail
- **Endpoint:** `GET /api/public/consumer/menu/items/:id`
- **Auth:** None
- **Params:** `id` – menu item ID
- **Query:** `branch_id` (required)
- **Response (200):** Menu item with variants, addons, modifier_groups. When the item is a deal (has deal components), the response includes a `deal` object with `deal_menu_item_id`, `name`, `price`, and `slots` (each slot has `slot_index`, `type`, `quantity`, `allow_customization`, `choice_items`, etc.) so the consumer can render the deal builder (e.g. pick choices per slot).

---

## Orders

### Place order
- **Endpoint:** `POST /api/public/consumer/orders`
- **Auth:** None
- **Headers (optional):** `x-client-platform: web` or `consumer_web` classifies the source as `consumer_web`; omit or use another value for native app (`consumer_app`). Used for loyalty and order-history filtering.
- **Body:**
```json
{
  "branch_id": 1,
  "order_type": "delivery",
  "customer_name": "John",
  "customer_phone": "03001234567",
  "customer_id": 42,
  "delivery_address": "123 Main St",
  "latitude": 24.8607,
  "longitude": 67.0011,
  "items": [
    {
      "menu_item_id": 1,
      "quantity": 2,
      "variant_id": 1,
      "addons": [{ "addon_id": 1, "quantity": 1 }],
      "modifiers": [{ "modifier_id": 7, "quantity": 1 }],
      "notes": "No onions"
    }
  ],
  "notes": "Ring doorbell",
  "discount_code": "SAVE10",
  "loyalty_points_to_redeem": 50
}
```
- **Field notes:**
  - `customer_phone`: Pakistani format `03XXXXXXXXX`. If sent, it must be valid. Required when `loyalty_points_to_redeem` &gt; 0 or when `customer_id` is set.
  - `loyalty_points_to_redeem`: Applied for both **`consumer_app`** and **`consumer_web`** (and POS). Requires `customer_phone`; points are capped by balance and order rules server-side.
  - `customer_id`: Optional. When set, must match the customer row for this tenant and the **same** normalized `customer_phone` (prevents attaching orders to another account).
  - `latitude` / `longitude`: Optional drop-off coordinates; stored on the order for delivery/pickup flows.
  - **Payment:** placing an order does not take payment. Use **`POST /api/public/consumer/orders/:id/pay`** with `phone` and `payment_method` after the order exists.
- **Response (201):** Created order object (structure depends on `OrdersService.createOrder`).

### Get order history
- **Endpoint:** `GET /api/public/consumer/orders`
- **Auth:** None
- **Query:** `phone` (required), `branch_id`, `tenant_id`, `limit`
- **Response (200):** Array of orders. Each item also includes:
  - `loyalty_points_balance`: current remaining loyalty points for this customer (for the resolved tenant)
  - `loyalty_points_redeemed`: points used in that order (0 when none)

### Get order status
- **Endpoint:** `GET /api/public/consumer/orders/:id/status`
- **Auth:** None
- **Params:** `id` – order ID
- **Response (200):**
```json
{
  "id": 1,
  "order_number": "ORD-001",
  "status": "confirmed",
  "total_amount": "2500.00"
}
```

### Get order payments
- **Endpoint:** `GET /api/public/consumer/orders/:id/payments`
- **Auth:** None
- **Params:** `id` – order ID
- **Query:** `phone` (required)
- **Response (200):** `{ "payments": [...] }`

### Get order details
- **Endpoint:** `GET /api/public/consumer/orders/:id`
- **Auth:** None
- **Params:** `id` – order ID
- **Query:** `phone` (required)
- **Response (200):** Full order object, including when applicable: `customer_id`, `delivery_latitude`, `delivery_longitude`, `loyalty_points_redeemed`, line items, payments.

### Cancel order
- **Endpoint:** `PATCH /api/public/consumer/orders/:id/cancel`
- **Auth:** None
- **Params:** `id` – order ID
- **Body:** `{ "phone": "+1234567890" }`
- **Response (200):** Updated order or success payload.

### Create payment for order
- **Endpoint:** `POST /api/public/consumer/orders/:id/pay`
- **Auth:** None
- **Params:** `id` – order ID
- **Body:**
```json
{
  "phone": "+1234567890",
  "payment_method": "cash",
  "amount": 2500,
  "reference_number": "REF123"
}
```
- **Response (200):**
```json
{
  "id": 1,
  "order_id": 1,
  "payment_method": "cash",
  "amount": 2500,
  "status": "completed",
  "reference_number": "REF123"
}
```

---

## Loyalty

### Get loyalty balance
- **Endpoint:** `GET /api/public/consumer/loyalty/balance`
- **Auth:** None
- **Query:** `branch_id`, `phone` (both required)
- **Response (200):** e.g. `{ "balance": 100, "displayName": "Reward Points", "spendPerPoint": 1000, "cashValuePerPoint": 10, "minOrderToEarn": 1, "minOrderToRedeem": 1 }`

---

## Cart

### Get cart
- **Endpoint:** `GET /api/public/consumer/cart`
- **Auth:** None
- **Query:** `phone`, `branch_id` (both required)
- **Important:** phone must belong to an existing customer. Recommended website flow: login/register first, then use cart APIs.
- **Response (200):** Cart with items (structure from `CartService.getCart`).

### Add cart item
- **Endpoint:** `POST /api/public/consumer/cart/items`
- **Auth:** None
- **Body:**
```json
{
  "phone": "+1234567890",
  "branch_id": 1,
  "menu_item_id": 1,
  "quantity": 2,
  "variant_id": 1,
  "addons": [{ "addon_id": 1, "quantity": 1 }],
  "modifiers": [{ "modifier_id": 7, "quantity": 1 }],
  "notes": "No ice"
}
```
- **Response (200):** Cart or added item (from `CartService.addItem`).

### Update cart item
- **Endpoint:** `PATCH /api/public/consumer/cart/items/:id`
- **Auth:** None
- **Params:** `id` – cart item ID
- **Query:** `phone`, `branch_id` (both required)
- **Body:** supports `quantity`, `variant_id`, `addons`, `modifiers`, `notes`
- **Response (200):** Updated cart/item.

### Remove cart item
- **Endpoint:** `DELETE /api/public/consumer/cart/items/:id`
- **Auth:** None
- **Params:** `id` – cart item ID
- **Query:** `phone`, `branch_id` (both required)
- **Response (200):** Success or updated cart.

### Clear cart
- **Endpoint:** `DELETE /api/public/consumer/cart`
- **Auth:** None
- **Query:** `phone`, `branch_id` (both required)
- **Response (200):** Success or empty cart.

---

## Error responses

- **400 Bad Request:** Invalid or missing body/params (e.g. missing `brand_id`/`branch_id` on register).
- **404 Not Found:** Resource not found (e.g. customer not found, branch not found, `email and password are required`).
- **409 Conflict:** e.g. duplicate email on profile update (if applicable).

---

## Forgot-password and email

- Ensure **MAIL_PORT=2525** (or 25/465/587) in `backend/.env` for Mailtrap. Port 456 is invalid.
- If the email is not registered, the API still returns 200 with the same message; no OTP is sent. Check terminal for: `Forgot password: no customer found for email …`.
- When an OTP is sent, terminal shows: `Forgot password: sending OTP to …`.
