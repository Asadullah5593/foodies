# Push notifications (admin → customer app)

Promos, announcements and repeating automations composed in the admin panel
(**Discounts & Promotions → Push Notifications**) and sent to customers who
have the mobile app. The automatic order-status pushes ("Chef is on it!",
rider assigned, …) are a different module (`backend/src/push-notifications/`,
`PushNotificationService`) and are not touched by anything here.

## The app's contract (cannot change — no new app builds)

- The app saves each phone's FCM token in **Firestore** at
  `users/{id}/tokens/{token}` with exactly `token`, `platform`
  (`android` | `ios`) and `lastUpdated` (server time), using `set()`. It is
  rewritten at every logged-in cold start and on token refresh, never after
  logout, and **never deleted** by the app. Guests save nothing.
- `{id}` is the customer id for customers and the **staff user id** for
  riders — one shared folder namespace, one Firebase project.
- A push without `data.screen` just opens the app (safe in every app state).
  Android needs channel `foodies_notifications`. Images show on Android only
  (no iOS Notification Service Extension).
- The app never signs in to Firebase Auth, so Firestore rules cannot tell who
  writes a token (the rules are the mobile developer's responsibility).

## How it works

| Piece | Where |
|---|---|
| Firestore mirror | `push_devices` + `PushDeviceSyncService`: full read of the `tokens` collection group every 3 h, before any send when older than 15 min, and on "Refresh now". Nightly (03:30 PKT) a token found under several owners is kept only under the newest `lastUpdated` and deleted elsewhere (Firestore + mirror) — this also stops a handed-down phone getting the previous owner's order updates. Dead tokens reported by FCM are deleted the same way. |
| Audience | `push-audience-rules.ts` (the rule registry: label, inputs, SQL) + `PushAudienceService.evaluate()`. Every customer is counted under the first reason that applies: no app → id equals a `rider_profiles.user_id` → `customers.push_opt_out` → already had this message (repeat "once" / "once every N days") → order in progress (placed/accepted/preparing/ready, ≤ 12 h old) → over the per-customer cap (sent rows in any 24 h / 7 days). A phone counts only for its newest owner. |
| Engine | `PushRunnerService`, `@Cron` every minute. Claims a due message atomically (`UPDATE … WHERE next_run_at = <read value>`) and opens a `push_message_runs` row unique on (message, scheduled_for). Recipients are inserted before sending, flipped `pending → sending` per batch of 200 customers and to `sent/failed` after; a run whose heartbeat is > 5 min old is resumed and its `sending` rows become `unknown` (never re-sent). Quiet hours hold due messages; a send already later than its own expiry is skipped. Repeats never replay missed occurrences. |
| FCM | `PushSenderService`: `sendEach` in chunks of 500, `data: { kind: 'promo', push_message_id }`, Android `priority: normal`, `ttl` = expiry, optional tag/collapse id for "replace my previous promo", no iOS badge. |
| Everything else | `PushMessagesService` (create/edit/actions, list, detail + results, recipients + CSV, test send, overview, saved audiences, templates, customer history / opt-out) and `PushSettingsService` (per-tenant row created with the defaults on first read). |

Times: `push_settings.timezone` (first non-UTC branch zone, else Asia/Karachi)
is used for every schedule and the quiet hours; stored instants are UTC.
`push-time.ts` does the zone maths with `Intl` (no date library).

## Rules

All rules: `got_message` (optionally "and did not order within N days" —
powers "Send again to non-buyers"), `phone`, `phone_list`,
`ordered_from_brand`, `ordered_at_branch`, `near_branch` (saved address or
customer pin within N km of the branch pin), `ordered_recently`, `lapsed`,
`never_ordered`, `joined` (between N and M days ago), `min_orders`,
`min_spend`, `ordered_item`, `ordered_category`, `mostly_order_type`,
`ordered_via`, `app_points`, `abandoned_cart` (server cart; only meaningful if
the app uses `/consumer/cart`), `platform` (with "match all" it also limits
which phones are sent to).

**Adding a rule:** add an entry to `AUDIENCE_RULES` (key, group, label,
description, params, `build(p, bind)` returning SQL on alias `c` with every
value passed through `bind`). If it needs a new input kind, add the type to
`RuleParamType`, its normalisation in `normalizeRule`, the frontend input in
`AudienceBuilder.tsx` `ParamInput` and a phrase in `pushText.ts`
`ruleSummary`. The page draws its picker from `GET /meta`.

## Scoping and permissions

- `push-notifications:view` (see everything), `:send` (create, schedule,
  test, edit, pause, cancel, opt-out), `:settings` (quiet hours, caps, expiry,
  test phones, phone-list refresh). Migration 133 grants all three to roles
  with slug `owner` only.
- Tenant-scoped; super admin (no tenant) is refused. Brand-locked staff see
  only messages / audiences / templates of their brand, every audience is
  limited to customers of their brand (ordered from it or linked via
  `brand_ids`, as on the Customers page), and a brand rule outside their reach
  is refused. Branch-limited staff likewise by order history at their
  branches. The author's reach is stored in `push_messages.scope` because the
  job sends without a request user.

## Results

Orders by recipients after `sent_at`, in 24 h / 3 days / 7 days, per send,
per A/B version and for the hold-back group (customers randomly not sent it),
so the real lift reads as "got it" rate minus "held back" rate. Opens and taps
cannot be measured (the app reports nothing back).

## Endpoints (`/api/admin/push-notifications`)

`GET meta`, `GET overview`, `POST audience/preview`, `POST schedule/preview`,
`POST test`, `GET|POST messages`, `GET|PUT|DELETE messages/:id`,
`POST messages/:id/{pause,resume,cancel,skip-next,duplicate}`,
`GET messages/:id/recipients[.csv]`, `GET|POST|PUT|DELETE audiences[/:id]`,
`GET|POST|PUT|DELETE templates[/:id]`, `GET|PUT settings`,
`POST devices/sync`, `GET customers/:id`, `PUT customers/:id/opt-out`.
The two preview POSTs are skipped by the activity log (they fire while typing).

## Frontend

`frontend/src/pages/Admin/PushNotifications/`: `PushNotifications.tsx` (tabs:
Notifications, Overview, Audiences, Templates, Settings), `PushComposer.tsx`
(`/new`, `/:id/edit`; `?template=`, `?audience=`, `?preset=`, `?resend=&days=`),
`PushMessageDetail.tsx`, `AudienceBuilder.tsx`, `SchedulePicker.tsx`,
`PhonePreview.tsx`, `CustomerPushCard.tsx` (on the customer page),
`pushText.ts` (wording + automation presets), `pushTime.ts`.

## Not built / known limits

- Android delivery counts from Google's FCM Data API (needs the API enabled on
  the Firebase project and an analytics label) — not built.
- Anyone can write a token under any id in Firestore while its rules are open;
  that is the app side's to fix.
- A customer whose id equals a rider's staff id is never sent promos.

## Tests

`cd backend && npx jest src/push-messages` (schedule maths, quiet hours,
personalisation, payload, rule validation and scoping);
`cd frontend && npx vitest run src/pages/Admin/PushNotifications`.
