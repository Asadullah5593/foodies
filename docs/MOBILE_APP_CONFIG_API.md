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
GET /api/public/app-config
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
