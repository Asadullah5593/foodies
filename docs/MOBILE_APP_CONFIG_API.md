# Mobile App Config API (force update)

Contract for the Flutter app to decide, at launch, whether this build is still
allowed to run. One endpoint, public, no auth.

> The response below is captured from the running backend, not hand-written.
> Base path is the API prefix `/api`.

---

## 0. The one rule that matters

**This endpoint fails open, and the app must too.**

Force-update is a lock on the customer's phone. Every path that is not a
deliberate "yes" — missing config row, database unreachable, request timed out,
JSON that will not parse — answers **no**. A database blip must never brick
every installed app at once.

So: if the call fails, times out, or returns anything the app does not
understand, **let the customer in**. Never block on a network error.

---

## 1. Endpoint

```
GET /api/public/app-config[?platform=android|ios]
GET /api/app-config          ← legacy alias, same handler (see §4)
```

- **No authentication.** The app reads this before anyone has logged in, and an
  out-of-date build may not be able to authenticate at all.
- **Never cache it.** The server sends `Cache-Control: no-store`. A cached
  `false` would outlive the moment someone flips the switch, which is the one
  moment this endpoint exists for.
- **Never errors.** Always `200` with a full body.

### Response

```json
{
  "force_update": false,
  "min_required_version": "1.0.0",
  "store_url": "https://apps.apple.com/app/foodies/id6769331907",
  "force_update_android": false,
  "force_update_ios": false,
  "min_required_version_android": "1.0.0",
  "min_required_version_ios": "1.0.0",
  "update_message": "A new version of Foodies is available. Please update to continue.",
  "store_url_android": "https://play.google.com/store/apps/details?id=com.rex.technologies.foodiespk",
  "store_url_ios": "https://apps.apple.com/app/foodies/id6769331907"
}
```

| Field | Type | Meaning |
|---|---|---|
| `force_update_android` / `_ios` | bool | Master switch for that platform. `false` ⇒ do nothing. |
| `min_required_version_android` / `_ios` | string | Semver. Block builds **below** this. |
| `update_message` | string | Show this text verbatim — it is how the business explains the block. |
| `store_url_android` / `_ios` | string | Where the "Update" button goes. |
| `force_update`, `min_required_version`, `store_url` | — | **Legacy, derived, never stored.** See §4. New clients must NOT read these. |

---

## 2. What the app should do

```
1. On launch (and on resume after a long background), GET /public/app-config.
2. On ANY failure → carry on as normal. Do not block, do not retry-loop.
3. Read force_update_<platform> and min_required_version_<platform>.
4. If force_update is true AND installed version < min_required_version:
       show a NON-DISMISSIBLE screen with update_message
       and a button opening store_url_<platform>.
   Otherwise: carry on.
```

Both conditions must hold. The boolean alone is the kill switch; the version is
what stops it locking users who already updated.

Compare versions **numerically, segment by segment** — not as strings.
`"1.10.0"` is newer than `"1.9.0"`, but string comparison says otherwise.

---

## 3. Notes for the backend side

Config lives in the `app_config` table, single row `id = 1`, created by
migration `1760000000121-AppConfig`. Editing is a direct DB update today; there
is no admin screen yet. If the row is missing the endpoint serves the defaults
above, so an unseeded environment behaves as "no force update" rather than
failing.

---

## 4. The legacy unsuffixed keys

Builds shipped before the per-platform keys existed (**v1.2.3 / build 125**)
read `force_update`, `min_required_version` and `store_url`. Those three are
**derived on the way out, never stored**, so they cannot drift from the
per-platform values — the suffixed keys are always authoritative.

**If you are writing new code, ignore them and read the suffixed keys.**

Pass `?platform=android` or `?platform=ios` and the generic keys describe that
platform exactly. The value is trimmed and case-insensitive; anything
unrecognised is treated as absent rather than rejected — this endpoint never
errors.

Without `platform` the request carries nothing identifying which store the
caller came from, so it falls back **iOS-then-Android**, as the mobile team
specified. That means **a legacy Android build with no `?platform=` reads the
iOS version and is sent to the App Store.** Send the parameter, or ship a build
that reads the suffixed keys.

One asymmetry worth knowing: `force_update` in the no-platform fallback is
`ios OR android`, so forcing an update on **either** platform raises the flag
for **all** legacy clients that did not send `?platform=`. They are still gated
by `min_required_version` (iOS's), so a client already above that version will
not be blocked — but it is why the version and the flag must be set together,
never the flag alone.

`/api/app-config` (no `public/` prefix) is a second **alias** for the same
handler, kept because **v1.2.4** hard-codes it. Both paths are pinned by tests.
Retire the alias once the access log shows no live build calling it.
