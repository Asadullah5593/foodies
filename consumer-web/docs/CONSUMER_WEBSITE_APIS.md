# Consumer Website APIs

Base URL: `/api/public/consumer`

This document lists all consumer APIs used by the `consumer-web` app.

## Required headers

- `x-client-platform: web` for website order source routing (`consumer_web`)
- `Authorization: Bearer <token>` only for protected profile endpoints if used

## Discovery and menu

- `GET /branches?latitude={lat}&longitude={lng}&radius_km={km}`
  - Fetch nearby branches after location permission
- `GET /brands?branch_id={branchId}`
  - Brands available for selected branch
- `GET /menu?branch_id={branchId}&brand_id={brandId}&search={searchTerm}`
  - Branch+brand menu list with search
- `GET /menu/items/{itemId}?branch_id={branchId}`
  - Item detail with variants, addons, modifier_groups (for modal customization)

## Auth

- `POST /register`
  - Body:
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "03001234567",
    "password": "secret123",
    "confirm_password": "secret123"
  }
  ```
- `POST /auth/login`
  - Body:
  ```json
  {
    "email": "john@example.com",
    "password": "secret123"
  }
  ```
- Optional recovery:
  - `POST /auth/forgot-password`
  - `POST /auth/verify-otp`

## Cart (customer phone + branch required)

Important: customer must exist (register/login first).

- `GET /cart?phone={phone}&branch_id={branchId}`
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
- `PATCH /cart/items/{cartItemId}?phone={phone}&branch_id={branchId}`
  - Body supports:
    - `quantity`
    - `variant_id`
    - `addons`
    - `modifiers`
    - `notes`
- `DELETE /cart/items/{cartItemId}?phone={phone}&branch_id={branchId}`
- `DELETE /cart?phone={phone}&branch_id={branchId}`

## Checkout and orders

- `GET /loyalty/balance?branch_id={branchId}&phone={phone}`
- `POST /orders` with `x-client-platform: web`
  - Body:
  ```json
  {
    "branch_id": 1,
    "order_type": "delivery",
    "customer_name": "John Doe",
    "customer_phone": "03001234567",
    "delivery_address": "123 Main St",
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
    "notes": "Leave at door",
    "discount_code": "SAVE10",
    "loyalty_points_to_redeem": 25
  }
  ```
- `GET /orders?phone={phone}&branch_id={branchId?}`
  - Include `x-client-platform: web` to fetch `consumer_web` order source
- `GET /orders/{orderId}/status`
- `GET /orders/{orderId}?phone={phone}`
- `PATCH /orders/{orderId}/cancel`

## Payments

- `POST /orders/{orderId}/pay`
  - Body:
  ```json
  {
    "phone": "03001234567",
    "payment_method": "cash",
    "amount": 2500,
    "reference_number": "REF123"
  }
  ```
- `GET /orders/{orderId}/payments?phone={phone}`

## Error handling notes

- `400`: invalid body or required fields missing
- `404`: branch/customer/order not found
- `409`: conflict scenarios

Frontend handling recommendation:
- Show concise friendly error text
- Keep retry for transient failures
- Do not clear cart/order input on recoverable errors
