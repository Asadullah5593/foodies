# Mobile Online Card Payments API (Meezan EPG)

Contract for the Flutter app to integrate online **card** payments via Meezan
Bank's E-commerce Payment Gateway (EPG). One-phase, hosted-checkout,
**create-on-confirm**: the order is created **only after** payment is confirmed.

> All request/response examples below are captured from the running backend, not
> hand-written. Base path is the API prefix `/api`.

---

## 0. The one rule that matters

**The return redirect is a UX signal only. It is NEVER proof of payment.**

Payment success is decided by our server (which checks directly with the bank).
The app learns the result **only** by calling the status endpoint (§3). If the
customer's internet drops after paying, or they close the page, or the redirect
never fires — the status endpoint still returns the truth. Never mark an order
paid because the WebView returned to your app.

---

## 1. Flow

```
1. Customer picks "Pay online (card)" and confirms the cart.
2. App  ── POST /public/consumer/payments/session  (the cart) ─────►
   Back ◄─ { session_id, status:"pending", form_url, expires_at } ─
3. App opens `form_url` in a WebView / Custom Tab.
4. Customer enters card + OTP on the bank's hosted page.
5. Bank redirects to https://app.foodies-pakistan.com/pay/return
   → deep-links back into the app (close the WebView).
6. App  ── GET /public/consumer/payments/session/{session_id} ─────►  (poll)
   Back ◄─ { status:"paid", order_group_id:"…" } ───────────────────
7. status == "paid" → show success + the order. Any other terminal
   status → show the matching screen (§4).
```

The order does **not** exist until `status:"paid"`. During the payment window
the app should show a payment screen, not an order.

---

## 2. Create a payment session

`POST /api/public/consumer/payments/session`

### Headers
| Header | Value | Notes |
|---|---|---|
| `Content-Type` | `application/json` | |
| `x-client-platform` | `app` | identifies the mobile app |
| `Authorization` | `Bearer <customer JWT>` | optional — include if the customer is logged in |

### Request body
Same cart you send to place an order. Send **only** these fields — do **not**
send `payment_split` or `bank_card_id` (the server sets tender to card itself;
any such fields are ignored).

```json
{
  "branch_id": 10,
  "order_type": "delivery",
  "customer_name": "Ali",
  "customer_phone": "03001234567",
  "delivery_address": "123 Main St, Lahore",
  "items": [
    { "menu_item_id": 3098, "quantity": 1 }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `branch_id` | int | yes | |
| `order_type` | string | yes | `delivery` \| `pickup` \| `takeaway` \| `dine_in` |
| `items` | array | yes | non-empty; same item/addon/modifier/deal shape as order placement |
| `customer_name` | string | no | |
| `customer_phone` | string | no | recommended (order + loyalty linkage) |
| `customer_id` | int | no | |
| `delivery_address` | string | no | for `delivery` |
| `latitude`,`longitude` | number | no | drop-off coords |
| `branch_latitude`,`branch_longitude` | number | no | |
| `delivery_tier` | string | no | `saver`\|`standard`\|`priority` for tier brands |
| `notes` | string | no | |
| `discount_code` | string | no | |
| `loyalty_points_to_redeem` | number | no | requires `customer_phone` |

### Response `201`
```json
{
  "session_id": "1bfed13c-f7a2-4db3-88fd-6a0d07402478",
  "status": "pending",
  "form_url": "https://acquiring.meezanbank.com/payment/merchants/.../payment_en.html?mdOrder=...",
  "expires_at": "2026-07-24T08:17:52.364Z",
  "order_group_id": null
}
```

| Field | Meaning |
|---|---|
| `session_id` | Opaque token. Use it for the status endpoint. **This is the only id you get** — never expose or guess numeric ids. |
| `status` | Always `pending` here. |
| `form_url` | Open this in the WebView / Custom Tab. |
| `expires_at` | ISO-8601. The payment window closes at this time (20 min). |
| `order_group_id` | `null` until paid. |

### Errors
| HTTP | When |
|---|---|
| `400` | Invalid cart (e.g. empty items, total ≤ 0, item not available for the order type). Body: `{ "message": "...", "statusCode": 400 }`. |
| `503` | Could not start the payment (bank unreachable). Body: `{ "message": "Unable to start the payment. Please try again." }`. Show a retry. |

---

## 3. Get payment status (the source of truth)

`GET /api/public/consumer/payments/session/{session_id}`

Call this after the WebView closes / the deep link fires, then **poll** every
~3–5 seconds until you get a terminal status (`paid`/`failed`/`expired`/`error`)
or `expires_at` passes. The server checks the bank on demand when you call this,
so it returns a fresh result.

### Headers
`x-client-platform: app` (and `Authorization` if logged in). No body.

### Response `200`
```json
{
  "session_id": "1bfed13c-f7a2-4db3-88fd-6a0d07402478",
  "status": "paid",
  "form_url": "https://acquiring.meezanbank.com/payment/.../payment_en.html?mdOrder=...",
  "expires_at": "2026-07-24T08:17:52.364Z",
  "order_group_id": "28056bff-88c5-4e28-ab0d-17bbc55e2ee3"
}
```

### `status` values
| status | Meaning | App action |
|---|---|---|
| `pending` | Not paid yet. | Keep polling (until a terminal status or `expires_at`). |
| `paid` | ✅ Payment confirmed, order created. `order_group_id` is set. | Show success; load the order (see §5). Stop polling. |
| `failed` | Bank declined the payment. | Show "payment failed"; offer **retry** = a brand-new session (§2). |
| `expired` | 20-minute window elapsed with no payment. | Show "session expired"; offer **retry** (new session). |
| `error` | Rare: payment was captured but the order couldn't be finalized on our side. | Show "we're confirming your order, please contact support"; **do NOT** auto-retry payment (money was taken). |

### Errors
| HTTP | When |
|---|---|
| `404` | Unknown `session_id`. Body: `{ "message": "Payment session not found", "statusCode": 404 }`. |

---

## 4. Timing, retries & edge cases (please handle all)

- **20-minute window.** The session expires at `expires_at`. After that the
  `form_url` stops working. To let the customer try again, request a **new
  session** (§2) — you cannot resume an expired one.
- **Retry = new session.** `failed`/`expired` → call §2 again to get a fresh
  `form_url`. Never reuse an old `session_id` to pay.
- **App backgrounded / killed mid-payment.** On resume (or when the order screen
  opens), re-poll §3. Do **not** assume failure because the app was closed.
- **Redirect never fires (internet dropped after paying).** The poll in §3 still
  returns `paid` — this is exactly why we poll and never trust the redirect.
- **Double-tap "Pay".** Create at most one session per checkout attempt; if a
  pending session already exists for this checkout, reuse its `form_url`.
- **Customer pays right at the 20-min edge.** Trust the status endpoint over the
  local clock — if it says `paid`, it's paid.

---

## 5. After `paid`

`order_group_id` is the id of the created order group. Load/track it with your
existing consumer order endpoints (e.g. the order status / order detail APIs)
using that group. The order is already in the kitchen at this point.

---

## 6. WebView vs Custom Tab

Open `form_url` in a **Chrome Custom Tab (Android) / SFSafariViewController
(iOS)** if possible — bank 3D-Secure/OTP pages are more reliable there than in a
raw WebView, and some acquirers disallow WebViews. A raw WebView is the
fallback; test both. The card number/CVV/OTP are always entered on the bank's
page — the app must **never** collect card details itself (keeps us out of PCI
scope).

Return URL: the bank redirects to `https://app.foodies-pakistan.com/pay/return`
(success) / `.../pay/fail` (failure). Your deep-link config already routes these;
on that deep link, close the WebView and poll §3.

---

## 7. Scope notes

- **Card only.** No JazzCash/Easypaisa, no saved cards (for now).
- **App only.** Website/POS don't use this.
- **Tax note:** the total is computed as **card tender** at session creation and
  is locked for that session. Because payment method affects the tax rate, the
  customer must choose "pay online (card)" **before** the final total is shown.
  If they abandon and switch to cash-on-delivery, that's a separate (re-priced)
  order flow.

---

## 8. Environments

- **UAT:** backend points `PAYMENT_PROVIDER` at Meezan's sandbox. Test cards are
  provided by the bank (note: the UAT test card does **not** trigger OTP, so the
  OTP/3DS screen can only be exercised in a small production test before launch).
- **Local/dev:** with `PAYMENT_PROVIDER=console` the backend mocks the gateway —
  `form_url` points back at the return URL and the session auto-confirms to
  `paid`, so you can build and test the full app flow without the bank.
