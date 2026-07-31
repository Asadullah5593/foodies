# Mobile Payments — Sandbox Testing Handbook (ngrok)

A step-by-step guide for the Flutter dev to test online card payments end-to-end
against the **Meezan sandbox**, through the backend running on a local machine
exposed via **ngrok**.

Read this alongside **[MOBILE_PAYMENTS_API.md](./MOBILE_PAYMENTS_API.md)** — that
doc has the exact request/response formats; this one is the *how to test it*
guide.

---

## 1. The setup (how the pieces connect)

```
Flutter app ──HTTPS──► ngrok URL ──► local backend :3001 ──► Meezan SANDBOX
     │                 (API calls: create session, poll status)
     │
     └──WebView / Custom Tab──► Meezan hosted payment page (direct, not via ngrok)
                                 └─ after paying, deep-links back to the app
```

- **API calls** (create session, poll status) go to the **ngrok URL**.
- The **payment page** (`form_url`) is loaded directly from Meezan
  (`test-securepayment.meezanbank.com:9716`) in a WebView / Custom Tab — *not*
  through ngrok.
- After payment, the bank redirects to `https://app.foodies-pakistan.com/pay/return`,
  which **deep-links back into the app**. Confirmation then comes from **polling
  the status endpoint** — never from the redirect itself.

The backend is already validated end-to-end against the sandbox (a real PKR 709
test payment created a real order). Your job is to drive the same flow from the
app.

---

## 2. Before you start — what you need from the backend owner

| You need | Value |
|---|---|
| **ngrok base URL** | e.g. `https://ab12cd34.ngrok-free.app` (changes each ngrok restart on the free tier — ask for the current one) |
| **Backend is on sandbox** | backend `.env` has `PAYMENT_PROVIDER=meezan` + sandbox creds, server restarted |
| **Sandbox is up** | Meezan UAT is only reachable **9am–6pm PKT, weekdays** |

### Sandbox test card
| Field | Value |
|---|---|
| Card number | `5380866334787911` |
| Expiry | `11 / 2030` |
| CVV | leave blank (this card has none; if the field is required, try `123`) |
| Cardholder name | any (e.g. `Test`) |
| OTP | **none** — this test card skips 3D-Secure, so the OTP screen won't appear |

> ⚠️ The sandbox card does **not** trigger OTP. The real OTP/3D-Secure screen can
> only be exercised with a real card in a small production test before launch —
> so build the WebView flow to *handle* an OTP page appearing even though you
> can't see it in sandbox.

---

## 3. Configure the app

Point your API client at the ngrok URL and set two headers on **every** API call:

```dart
final baseUrl = 'https://ab12cd34.ngrok-free.app/api'; // note the /api prefix

final headers = {
  'Content-Type': 'application/json',
  'x-client-platform': 'app',            // REQUIRED — identifies the mobile app
  'ngrok-skip-browser-warning': 'true',  // REQUIRED — see troubleshooting #1
  // 'Authorization': 'Bearer <customer JWT>',  // if the customer is logged in
};
```

Both endpoints are under `/api/public/consumer/payments/...` — see the API doc.

---

## 4. The test flow (what your code does)

### Step 1 — Create a session
`POST {baseUrl}/public/consumer/payments/session` with the cart (see API doc §2).

Response:
```json
{
  "session_id": "699429c1-c808-4162-83be-d68626f26dcd",
  "status": "pending",
  "form_url": "https://test-securepayment.meezanbank.com:9716/epg/merchants/ibft_merchant/payment.html?mdOrder=...",
  "expires_at": "2026-07-24T10:17:35.836Z",
  "order_group_id": null
}
```
**Keep `session_id` in memory** — you need it to poll and to resume after the
WebView closes. Start a countdown to `expires_at` (~20 min).

### Step 2 — Open `form_url`
Open it in a **Chrome Custom Tab (Android) / SFSafariViewController (iOS)**
(preferred), or a WebView (fallback). The customer pays with the test card.

### Step 3 — Detect the return
- **Custom Tab / SFSafariViewController:** rely on the App Link / Universal Link
  for `app.foodies-pakistan.com/pay/return` to bring the user back to the app
  (your `DeepLinkService` already routes `/pay/return`).
- **WebView:** intercept navigation — when the WebView tries to load a URL
  containing `app.foodies-pakistan.com/pay/return`, **stop it**, close the
  WebView, and go to Step 4. Do **not** wait for that page to load (it's just a
  deep-link trigger and may render blank).

> The return URL carries no payment result you can trust. It only tells you
> "the customer came back." The real result comes from Step 4.

### Step 4 — Poll for the result (source of truth)
`GET {baseUrl}/public/consumer/payments/session/{session_id}` every ~3–5s until
you get a terminal status or `expires_at` passes.

```json
{ "session_id": "...", "status": "paid", "order_group_id": "c4553f1c-...", ... }
```

| `status` | Do |
|---|---|
| `pending` | keep polling |
| `paid` | ✅ success — load/track the order via `order_group_id`, stop polling |
| `failed` | show "payment failed", offer retry = **new session** (Step 1) |
| `expired` | show "session expired", offer retry = **new session** |
| `error` | show "we're confirming your order, contact support" — do **not** auto-retry (money was captured) |

That's the whole loop.

---

## 5. Scenarios to test

1. **Happy path** — pay with the test card → `paid`, order appears.
2. **Abandon** — open `form_url`, close it without paying → after ~20 min the
   next poll returns `expired`; "retry" makes a fresh session.
3. **App killed mid-payment** — pay, then kill the app before returning. Reopen →
   on the order/payment screen, re-poll the stored `session_id` → `paid`. (Proves
   you never rely on the redirect.)
4. **Return-redirect dropped** — pay, then turn off wifi briefly so the redirect
   never fires; reconnect and poll → still `paid`.
5. **Double-tap "Pay"** — ensure you create only one session per checkout.

---

## 6. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| **API returns an HTML page / "You are about to visit…"** instead of JSON | ngrok's browser-warning interstitial. **Add header `ngrok-skip-browser-warning: true`** to every API request. |
| **API works then suddenly 404 / wrong host** | ngrok free URL changed on restart. Get the new base URL from the backend owner. |
| **`400` on create session** | Invalid cart (empty items, item not available for that `order_type`, total ≤ 0). Check the `message` in the body. |
| **`503` "Unable to start the payment"** | Backend couldn't reach Meezan — sandbox down or outside the **9–6 PKT weekday** window. Retry in-window. |
| **`404` "Payment session not found"** on poll | Wrong/expired `session_id`, or you hit a different ngrok URL than the one that created it. |
| **Return page is blank / shows an error** after paying | Expected. `app.foodies-pakistan.com/pay/return` is a deep-link trigger, not a real page. Intercept the navigation (WebView) or rely on the App Link (Custom Tab); then poll. |
| **Payment page rejects the card / asks for CVV** | Use exactly `5380866334787911`, exp `11/2030`. Leave CVV blank; if forced, try `123`. |
| **No OTP screen appears** | Correct — the sandbox test card skips 3D-Secure. OTP can't be tested in sandbox. |
| **Poll stays `pending` forever after a successful payment** | The backend polls the bank on each status call; give it a few seconds. If it never flips, the payment may not have completed at the bank — check with the backend owner (server logs show the bank's `orderStatus`). |
| **`status: "error"`** | Rare: payment captured but order couldn't be created (e.g. item sold out during the window). Don't retry payment; surface a "contact support" message. |

---

## 7. Hard rules (do not skip)

1. **Never trust the redirect. Always poll** `GET …/session/{id}` for the result.
2. **Never collect card details in the app.** The card number/CVV/OTP are only
   ever entered on Meezan's hosted page (keeps us out of PCI scope).
3. **Never point at production.** Sandbox only for all testing.
4. **Choose "pay online (card)" before showing the final total** — payment
   method affects the tax rate, so the total is computed as card tender when the
   session is created.
5. **Retry = a new session.** Never reuse a `session_id` / `form_url` after
   `failed` or `expired`.

---

## 8. What "it works" looks like end-to-end

- Create session → `pending` + a real Meezan `form_url`.
- Pay on the page → Meezan shows "Successful transfer!" (PKR amount, your order
  description).
- App returns via deep link → poll → `status: "paid"` + `order_group_id`.
- The order is now live (already in the kitchen) and trackable by that group.

If you get that, the integration is working. Ping the backend owner with the
`session_id` if any step behaves unexpectedly — they can see the exact bank
response in the server logs.
