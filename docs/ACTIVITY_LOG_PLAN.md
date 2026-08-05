# Activity / Audit Log — implementation plan

> **Status:** Phase 0 built and verified on the dev DB (2026-08-05). Phases 1–6
> outstanding. Branch `feat/activity-log`.
> **Anchors verified against the tree on 2026-08-05.** Line references drift; the
> "Verified anchors" table at the end is the source of truth and should be
> re-checked at the start of each phase.

---

## 1. Context

The system has **no application audit log**. When something needed investigating in
production, the only forensic material was nginx `access.log` plus Postgres `xmin` —
actors had to be inferred from response byte sizes and brand-locks. That is not a
workable basis for settling a dispute about who changed a price, who took cash out,
or who looked at a customer's phone number.

Two structural gaps make this worse:

- **`updated_by` does not exist anywhere in the schema.** Verified 2026-08-05:
  **0 of 95 entities** carry `updatedBy`/`updated_by`; 12 record `created_by`. Every
  `PUT`/`PATCH` on menu, brands, branches, users, roles, discounts and campaigns
  currently leaves no actor trace at all.
- **Role history is destroyed in place.** `updateRole` assigns
  `role.permissions = <new set>` and saves. There is no history table, so resolving
  "what could this user do?" at read time gives you *today's* permissions for *last
  March's* action — backwards for forensics.

Outcome wanted: for any action, answer **who did it, from where, to which record,
what the value was before, and under what role** — and keep that for a year.

### 1.1 `updated_at` is NOT missing — correcting a premise

A question was raised about adding `updated_at` columns to production. It is not
needed: **76 of 95 entities already declare `@UpdateDateColumn`**. What is missing is
`updated_by` (0 of 95).

**Recommendation: do not add `updated_by` at all.** Once the activity log is live it
answers "who last changed this row" *and* "what it was before" *and* "under what
role" — strictly more than a single `updated_by` column, without touching a single
existing table. Adding 15–40 columns to hot production tables to record a weaker
version of the same fact is a bad trade.

If a specific screen later needs a cheap "last edited by" without querying the log,
see §6.3 for how to add that one column safely.

### 1.2 Decisions

| | |
|---|---|
| Scope | Every mutating request **+ sensitive reads** (customer PII, salaries, reports, shift cash). High-frequency POS/KDS/rider-GPS/cart traffic excluded. |
| Client events | Prints, CSV exports, sensitive page views — **~5 instrumentation points**, not every button. |
| Detail | Actor + role-at-time + IP + route + redacted payload + status + timing on every row; **before/after diffs** on high-value records. |
| Retention | **1 year**: hot in Postgres for 3 months, then auto-archived to compressed files and the partition dropped. |
| Archive format | **gzipped NDJSON** + sibling manifest (§7.2). |
| Archive store | **S3**, reusing `media/media-storage.service.ts` credentials, ideally with Object Lock (§7.3). |
| Manual purge | Whole months only, password re-auth, **90-day floor** (§7.4). |
| Runtime control | DB-backed settings with an env hard-override (§8). |

> **On "every button click":** literal per-click instrumentation was considered and
> rejected — it needs tagging every control across 88 admin pages forever, produces
> enormous low-value noise, and still misses anything done outside the UI (curl,
> mobile app, another admin). Server-side capture at the request boundary is strictly
> more complete. The few clicks that *never* reach the server (printing a Z-report,
> exporting a ledger) are covered explicitly by the beacon in Phase 4.

---

## 2. Architecture

Capture is **middleware-owned**, not interceptor-owned. This is the single most
important design decision:

> Nest runs guards **before** interceptors (`router-execution-context.js` awaits
> `fnCanActivate` before `interceptorsConsumer.intercept`). So an interceptor **never
> sees 401s or 403s** — a guard rejection throws before the interceptor exists.
> Denied-access attempts are among the highest-value audit events, so an
> interceptor-only pipeline would silently miss exactly what matters most.

Three cooperating pieces:

1. **`ActivityLogMiddleware`** — owns the lifecycle. Mints/echoes `X-Request-Id`,
   opens an `AsyncLocalStorage` store, and emits the row on `res.on('finish')`.
   Because it fires *after the response is flushed*, audit work adds **zero latency**
   to the user request by construction, and it captures guard rejections, validation
   400s, 500s and 404s.
2. **`ActivityLogInterceptor`** (`APP_INTERCEPTOR`) — **enrichment only**. Adds
   controller/handler names, `@RequirePermission` metadata (the action label), and
   the response body for id extraction. Never transforms the stream. If it never
   runs, the middleware still emits a complete row. *(Verified: the repo has no
   `APP_INTERCEPTOR`/`APP_GUARD`/`APP_FILTER` today — this is the first.)*
3. **`ActivityContext`** (`node:async_hooks`, no new dependency) — services call
   `ActivityContext.recordChange(entityType, id, before, after)`; the middleware
   drains it into the row. **No-op when no store exists**, so seeds, cron jobs and
   specs stay callable untouched.

**Why not a TypeORM subscriber for diffs:** **119** `.query()` call sites in services
bypass subscribers entirely (was 98 a week ago — the number is growing), as does
`QueryBuilder.update()/.delete()`. Silent gaps precisely where the money is.
Subscribers also run inside the caller's transaction, so a failing diff would roll
back a real business write. Explicit `recordChange()` at ~25 sites, with
`@Audit({ diffExpected: true })` making any missing coverage *visible* rather than
silent.

---

## 3. The table

`activity_logs`, **partitioned monthly by `created_at`** (`PARTITION BY RANGE`),
PK `(created_at, id)`.

Column groups: correlation (`request_id`, `session_id`, `device_id`) · actor
(`actor_type`, `actor_user_id`, `actor_label`, **`actor_role_slugs` /
`actor_role_names` snapshotted**, `actor_is_super_admin`) · scope (`tenant_id`,
`branch_id`, `brand_id`) · what (`action`, `action_group`, `entity_type`,
`entity_id`, `entity_label`, `summary`) · how (`http_method`, `route`, `query`,
`request_body` jsonb, `response_meta` jsonb, `status_code`, `outcome`,
`duration_ms`) · diffs (`changes` jsonb, `changed_fields` text[]) · forensics (`ip`,
`user_agent`, `payload_truncated`, `diff_expected`).

Four indexes on the parent (auto-inherited by every partition):
`(tenant_id, created_at DESC)`, `(actor_user_id, created_at DESC)`,
`(entity_type, entity_id, created_at DESC)`, `(tenant_id, action, created_at DESC)`.

Deliberate choices:

- **`timestamptz`** (house convention is bare `timestamp`) — retention cuts and
  partition boundaries must be unambiguous. Deviation noted in the migration comment.
- **Actor FKs `ON DELETE SET NULL`**, matching `shift_cash_outs` — deleting a user
  must never destroy the trail.
- **`entity_id` is varchar** — order groups are UUIDs.
- **`DEFAULT` partition** as a safety net so a row is never lost to a maintenance
  gap; the job stays 2 months ahead so it stays empty. A non-empty default partition
  is an alarm.
- **No `pg_trgm`** initially — `CREATE EXTENSION` needs privileges the app user may
  lack. Every query is date-bounded anyway.

**Sizing:** ~7k rows/day baseline → **~4 GB/year** in Postgres; 25k/day at 3× growth
→ ~15 GB/year. With the 3-month hot window of §7.1 the live table stays ~1 GB.
Budget 10 GB steady state, alarm at 20 GB.

---

## 4. Production safety: why this cannot cause downtime

The system is live and cannot absorb downtime. This section is the contract.

### 4.1 The boot-time migration risk (the real one)

`app.module.ts` sets **`migrationsRun: true`** — migrations execute inside the app
process at startup, and PM2 restarts the app on deploy. A migration that blocks
therefore blocks *startup*, and a blocked startup is an outage.

Mitigations, all mandatory:

1. **Phase 0 creates only new objects.** `CREATE TABLE`, its partitions, its indexes,
   two permission rows, `REVOKE` on the new table. It issues **no `ALTER TABLE`
   against any existing table** — so it takes no lock any live query can be waiting
   behind. On an empty new table, index creation is instant.
2. **Guard rails inside the migration:**
   ```sql
   SET LOCAL lock_timeout = '3s';
   SET LOCAL statement_timeout = '30s';
   ```
   This is the difference between "the migration fails and the deploy stops" and
   "the migration queues for a lock and every request behind it queues too". Fail
   fast, never wait.
3. **Rehearse on a restored prod snapshot**, timed, before the real run.
4. **Deploy window**: off-peak, with `pm2 logs` watched. Boot is the only moment the
   migration runs.

**Versions (confirmed 2026-08-05): prod is PostgreSQL 17.9, dev is 14.23.**

Everything the design needs is supported on both: range partitioning (10+), the
DEFAULT partition (11+), metadata-only `ADD COLUMN` (11+), and — the one that
matters most — row triggers on a partitioned parent, which enforce append-only and
need 13+.

The three-major gap is itself a risk to manage, not a blocker. Phase 0 was verified
on 14.23, which is the *weaker* case for the trigger cascade, so a pass there
implies a pass on 17. But the migration rehearsal (§11) must run against a
**restored prod snapshot on 17**, not the dev box, before anything is enabled in
production.

### 4.2 Runtime safety

| Risk | Guarantee |
|---|---|
| Added latency | Row is emitted on `res.on('finish')`, **after** the response is flushed. Zero added latency by construction. |
| DB pool exhaustion | Buffered writer: batches of 200 rows / 1 s, one multi-`VALUES` INSERT. One checkout per *batch*, not per request. |
| Unbounded memory | Bounded queue (10k). Overflow drops oldest and records a counted `system` row, so loss is *visible*, never silent. |
| DB down / slow | Circuit breaker after 5 consecutive failures; capture goes to a no-op and retries later. |
| A bug in audit code | Every write path is `try/catch → logger.error`. Nothing rethrows. Nothing opens a transaction. Nothing participates in a caller's transaction. |
| Restart losing the buffer | `app.enableShutdownHooks()` (currently absent from `main.ts`) plus an `onApplicationShutdown` flush. |
| The feature itself being wrong | Ships **disabled**. `ACTIVITY_LOG_ENABLED=false` until deliberately turned on, and the kill switch stays available forever. |

### 4.3 Rollback

- **Code:** flip the flag off. No deploy needed once §8 lands; env var + restart before that.
- **Schema:** `down()` drops `activity_logs` and its partitions. Nothing else in the
  database was touched, so rollback cannot affect orders, menu or shifts.
- **Branch:** all work lands on `feat/activity-log` and merges as one reviewable unit.

---

## 5. Phases

Each phase lands independently and is revertable. Only Phase 0 touches the schema.

### Phase 0 — Foundations (invisible at runtime) — ✅ DONE

Landed: migration `1760000000107-ActivityLogs.ts`, `activity-log.entity.ts`,
`activity-log/` (module, writer, redaction, policy, activity-context, maintenance),
permission constants + seed rows, module registered in `app.module.ts`.
Verified on dev: partitions and indexes created, rows route to the right partition,
append-only enforced (§9), `down()` fully reverses, entity ↔ table columns match
35/35, 18 redaction specs green, full backend suite 484/484.

- `backend/src/migrations/1760000000107-ActivityLogs.ts` — table, partitions,
  indexes, `REVOKE UPDATE, DELETE`, and the `activity-log:view` /
  `activity-log:export` / `activity-log:purge` / `activity-log:configure`
  permissions seeded + granted to `owner`/`super_admin`.
  **Template: `1760000000102-ShiftCashOuts.ts`** (permission insert with
  `ON CONFLICT DO NOTHING` + role grant by slug).
  ⚠️ **`…103` is taken by `StaffDiscounts`; the highest existing is `…106`.**
  Re-check `ls backend/src/migrations | sort | tail -1` immediately before creating
  the file — the plan's original number would have collided.
- `backend/src/entities/activity-log.entity.ts`
- `backend/src/activity-log/` — module, writer, redaction, policy,
  `activity-context.ts`, maintenance service.
- Permission constants in `backend/src/roles/permissions.dto.ts` + `seed.ts` row.
- **Live-DB role slugs:** grant to both `brand_admin`/`brandadmin` style variants
  where relevant — seed slugs and production slugs differ (see the permission
  migration precedent).

### Phase 1 — Capture, dark

- `backend/src/main.ts` — `app.use(...)` as the **first** line after
  `NestFactory.create` (line 9, before `setGlobalPrefix` on line 10), plus
  **`app.enableShutdownHooks()`** (verified absent).
- Middleware + `APP_INTERCEPTOR`.
- Ships with `ACTIVITY_LOG_ENABLED=false`. Enable in staging → load-test → sample
  200 rows for secrets → enable in prod.

**Writer:** as §4.2. **Security-critical rows** (login success/failure, role &
permission changes, user create/delete, shift close, cash-out, price change,
discount create) bypass the buffer and write immediately.

**Redaction (the highest-probability risk):**

- Request body — key deny-list at any depth: `password`, `new_password`,
  `confirm_password`, `owner_password`, `id_token`, `fbr_token`, `token`,
  `qr_token`, `access_token`, `secret`, `api_key`, `cvv`. `code` is redacted **only
  on the 4 OTP routes** — elsewhere `code` is legitimate audit data
  (`inventory_items.code`, coupon codes).
- Headers and **responses are allow-list only**. This structurally kills the
  `fbr_token` echoed by `branches.service.ts:181` (verified still there) — we never
  copy a response wholesale. `response_meta` picks `{id, count, order_number,
  status}` only.
- **Never spread `req.user`**: the consumer JWT strategy returns the full `Customer`
  entity and `customer.entity.ts:26` declares `password` with no `select:false` —
  a naive log would store bcrypt hashes for every consumer request.
- Multipart (`upload.controller.ts:25`, `consumer.controller.ts:927`) — store file
  metadata, never buffers.
- 8 KB payload cap, 16 KB diff cap.

**Actor classification:** `req.user == null` → kiosk (if `x-kiosk-api-key`) else
anonymous; `'tenantId' in req.user` → staff/rider; otherwise customer. **Super admins
short-circuit `RoleAccessGuard` at line 57** (`if (user.tenantId == null) return
true`), so their `permissions`/`allowedBranchIds` are `undefined` — record
`actor_permissions = NULL` (never `[]`, which would read as "held no permissions"),
and set `actor_is_super_admin`. `tenant_id`/`branch_id` come from the **subject**
(params/body/recorded entity), never from the actor's access scope.

**Skip list:** POS order create/quote, KDS status churn, rider GPS pings, consumer
cart. **Kept:** order pay/void/refund, kiosk submits, login success *and failure*.

**Sensitive-read allow-list:** `/admin/customers`, `/admin/rider-hrm/profiles` +
payroll, all `/admin/reports/*`, `/admin/shifts/:id` + cash-outs,
`/admin/branches/:id`, and the activity log itself. Repeat reads collapse to one row
per 5 min per (actor, route, query) — without this, report polling alone is ~8k
rows/day.

### Phase 2 — Read UI

`frontend/src/pages/Admin/ActivityLog.tsx`, mirroring `pages/Admin/Orders.tsx`:
URL-driven filters (`useSearchParams`), 300 ms debounced search, server pagination
envelope `{data, total, page, page_size, outcome_counts}`,
`placeholderData: keepPreviousData`, `PaginationBar`, per-filter `useHasPermission`
gating.

**API enforces a bounded date range** (default 7 days, max 92) — this is what
guarantees partition pruning.

Detail drawer: summary, actor block explicitly labelled **"role at the time of the
action"**, redacted values shown as grey `[redacted]` pills (visible removal, not
silent absence), and the **diff table** as the centrepiece (Field | Before | After;
permission changes as `+ added` / `− removed` chips). Related-events panel via
`request_id`. **No edit/delete controls anywhere.**

Registration: nav item + route in `App.tsx`, `PATH_PERMISSIONS` entry in
`lib/pathPermissions.ts`, matching backend `auth/path-permissions.ts` entry, and
`services/api/activityLogService.ts`. `resource = 'activity-log'` means
`roleShared.ts` labels it "Activity Log" with no change.

### Phase 3 — Diffs

`ActivityContext.recordChange()` instrumentation, in this order (each independent;
the diff panel lights up incrementally):

1. **Roles** (`roles.service.ts` — permission set diffs as added/removed; highest
   forensic value since history is otherwise destroyed)
2. **Users** (`users.service.ts` + `branch-users.service.ts`; `password → '[changed]'`)
3. **Menu/prices** (`menu.service.ts` update*, `branch-menu-items.service.ts`)
4. **Discounts/coupons** → 5. **Shifts/cash-outs** → 6. **Inventory/procurement**

Numeric normalisation is mandatory: TypeORM returns `decimal` as **strings**, so
`'12.00'` vs `12` would produce phantom diffs on every money field.

### Phase 4 — Client beacon

- `frontend/src/utils/apiClient.ts` — mint `X-Request-Id`/`X-Session-Id`/
  `X-Device-Id` in the existing request interceptor (total choke point: 62
  importers, only 2 raw fetches and both are third-party geocoding).
- `frontend/src/utils/activityBeacon.ts` — queued, debounced,
  `fetch(..., {keepalive:true})` (not `sendBeacon`, which cannot set
  `Authorization`). Fully try/caught; cannot break the UI.
- `POST /api/activity-logs/events` — action validated against a server-side enum;
  **client supplies the *what*, server supplies the *who*** (actor/tenant/IP from the
  JWT, never the body).
- Instrument: `utils/print.ts` `printContent()` (sole print funnel → all 6 callers),
  the 2 CSV exporters (`Inventory/StockLedger.tsx`, `Inventory/Inventory.tsx`), and
  `useSensitivePageView` on Reports/Customers/Shifts/RiderProfiles/Payroll/Roles.
- **Critical:** `CustomerInvoiceModal.tsx` auto-prints with no user interaction — and
  fires **two** prints (`handlePrint()` + `handlePrintKot()`). Thread a
  `trigger: 'user' | 'auto'` flag through — otherwise the log claims a human
  deliberately printed ~4,000 documents a day.

### Phase 5 — Record history

"History" button/drawer on the record pages that matter (menu item, role, user,
branch pricing), served by the `(entity_type, entity_id, created_at DESC)` index.
This is what makes the feature get used day to day rather than only after an
incident.

### Phase 6 — Archive, purge & runtime controls

See §7 and §8. Lands last because it is only meaningful once real rows exist, and it
is the only phase that deletes anything.

---

## 6. Retention model

### 6.1 Automatic tiering (the default path)

A monthly job, in the maintenance service:

1. Ensure the next 3 partitions exist.
2. For every partition older than **`ACTIVITY_LOG_HOT_MONTHS` (default 3)**:
   archive it (§7), verify, then `DROP TABLE <partition>`.
3. Delete archives older than **13 months** from the store (or leave them if the
   bucket has a lifecycle policy — prefer the bucket policy).

Consequence: the live table stays ~1 GB, the full year stays readable, and
destructive manual purging stops being part of normal operations. Dropping a
partition is instant and reclaims space with no vacuum storm — the point of
partitioning.

Runs boot-time + `EVERY_DAY_AT_4AM` (2 AM and 3 AM are taken), mirroring
`orders/rider-location-retention.service.ts` (daily cron + `*_DRY_RUN` flag + one
summary log line), advisory-locked via `common/db-concurrency.ts`.

### 6.2 Ordering guarantee

**Archive → verify → drop. Never drop first.** The job compares the archived row
count and SHA-256 against the partition before issuing `DROP TABLE`, and aborts the
whole run on any mismatch, S3 error or checksum failure. A failed archive leaves the
data exactly where it was and logs an error; the next run retries.

### 6.3 If you ever do want `updated_by`

Not recommended (§1.1), but if a screen needs it later, the safe recipe on PG ≥ 11 is:

```sql
SET LOCAL lock_timeout = '3s';
ALTER TABLE menu_items ADD COLUMN updated_by integer;          -- metadata-only, instant
-- FK, if wanted at all, in a SEPARATE migration:
ALTER TABLE menu_items ADD CONSTRAINT fk_menu_items_updated_by
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL NOT VALID;  -- no scan
ALTER TABLE menu_items VALIDATE CONSTRAINT fk_menu_items_updated_by;           -- no write block
```

Nullable, no default, no backfill, `NOT VALID` then `VALIDATE` so the table is never
scanned under an exclusive lock. One table per migration. Never `SET NOT NULL` on a
populated table without a validated `CHECK` first.

---

## 7. Archive & purge

### 7.1 What an archive is

One file per partition-month:

```
activity-logs/2026-01/activity-logs-2026-01.jsonl.gz     ~20–30 MB
activity-logs/2026-01/activity-logs-2026-01.manifest.json
```

### 7.2 Format: gzipped NDJSON

One JSON object per line, **every column of the original row**, ISO-8601 timestamps,
`jsonb` columns inlined as real JSON. Streamed out with a server-side cursor and
`zlib.createGzip()` so memory stays flat regardless of month size.

Chosen because it is the smallest format that is still readable years from now with
tools that exist everywhere, and needs no version of our code to interpret:

```bash
zcat activity-logs-2026-01.jsonl.gz | jq 'select(.actor_label=="Ali" and .action=="role.update")'
```

Estimates from the §3 sizing: ~250 MB raw per month → **~20–30 MB gzipped**;
~250–350 MB for a full year. *(Parquet+zstd would be 2–3× smaller and queryable via
DuckDB but needs a library and is not human-readable; Brotli is ~20% smaller than
gzip with less universal tooling. Revisit only if size becomes a real constraint.)*

The manifest carries: schema version, row count, min/max `created_at`, byte size,
**SHA-256 of the .gz**, the partition name, who triggered it, and the app version.

### 7.3 Where archives live

S3, reusing `media/media-storage.service.ts` (already credentialed), under its own
prefix with SSE. **Object Lock in compliance mode on that prefix gives genuine
write-once storage** — which is the only thing in this design that provides real
tamper-evidence, since in-database integrity is theatre when one DB user can write
everything.

Object Lock must be enabled at bucket creation, so this likely means a **dedicated
audit bucket**. If that is not acceptable, degrade to: versioning on + a bucket
policy denying `DeleteObject`/`PutObject` overwrite to the app's IAM role. Local disk
is the fallback for dev only.

### 7.4 Manual purge

Exposed as **"Archive & purge a month"**, never a row-level delete:

- Requires `activity-log:purge` (owner/super-admin) **and password re-auth** — the
  operator re-enters their own password, compared with `bcrypt.compare` exactly as
  `auth.service.ts:66` does. Failed attempts are logged and rate-limited.
- **90-day floor**: the current month and anything younger than 90 days cannot be
  purged, by any role, ever. This is the rule that makes the log worth having — the
  recent history a wrongdoer would want to erase is structurally out of reach.
- Runs the same archive → verify → drop pipeline. Never deletes anything that is not
  already durably archived.
- **The purge writes its own activity row** — actor, time, range, row count, archive
  filename and checksum — into the current partition, which by the rule above can
  never itself be purged.
- Month granularity, because purge is `DROP TABLE <partition>`. Arbitrary row
  deletion would require restoring the `DELETE` grant the migration revokes; it is
  not offered.

### 7.5 Reading archives back

- **Archives tab** in the UI: month, row count, size, checksum, who archived it,
  download link (permission-gated, and downloading is itself logged).
- **`npm run activity-log:restore <file>`** — recreates the month as a partition so
  the normal UI can browse it; drop it again when finished.
- Worst case, with no app at all: `zcat | jq`. That is the point of the format.

---

## 8. Runtime controls (enable/disable from admin)

Settings live in a single-row-per-scope `activity_log_settings` table (precedent:
`notification-setting.entity.ts`; business settings themselves hang off `tenants`),
cached in-process with a short TTL and refreshed on write.

Exposed controls:

| Setting | Values | Default |
|---|---|---|
| `capture_level` | `off` · `mutations` · `mutations+sensitive_reads` · `all` | `mutations+sensitive_reads` |
| `pii_mode` | `mask` · `full` · `none` | `mask` |
| `hot_months` | 1–12 | 3 |
| `retention_months` | 3–24 | 13 |
| module opt-outs | per action group | none |

Guard rails, because a kill switch is the obvious evasion route:

- Changing any of these needs `activity-log:configure` **and password re-auth**.
- **The change is logged before it takes effect**, with old and new values.
- While capture is `off` or reduced, every admin page shows a persistent banner:
  *"Activity logging has been OFF since 14:20 on 5 Aug, switched off by Ali."*
  Silent disablement is not possible.
- **`ACTIVITY_LOG_ENABLED=false` in the environment always wins** — an emergency
  brake that does not depend on the database being reachable.
- If the settings read fails, the last known good value is kept (never silently
  fails to `off`).

---

## 9. Integrity

- **Append-only:** the service exposes only `find*`; raw parameterised INSERT only.
  Retention still works because `DROP TABLE <partition>` needs ownership, not
  `DELETE`.

  ⚠️ **Corrected 2026-08-05 by testing, not reasoning.** The plan originally relied
  on `REVOKE UPDATE, DELETE`. That is **ineffective here**: the app user *owns*
  `activity_logs`, and Postgres grants owners their privileges implicitly, so the
  REVOKE changes `information_schema.table_privileges` but not behaviour. Measured
  on 14.23: after the REVOKE, `UPDATE`, `DELETE` **and** `TRUNCATE` all still
  succeeded.

  Enforcement is therefore a **trigger** (`activity_logs_append_only()`), which
  fires for the owner too and — on PG 13+ — cascades from the partitioned parent to
  every partition, present and future. Verified: `UPDATE`/`DELETE`/`TRUNCATE` are
  refused both on the parent and directly on a partition, while `CREATE`/`DROP
  PARTITION` still work so retention is unaffected. The REVOKE is kept as belt and
  braces for the day the table is owned by a different role.

  A table owner can still drop the trigger. That is unavoidable with one DB role,
  and is exactly why real tamper-evidence comes from the write-once S3 archive
  (§7.3) rather than from anything inside the database. What the trigger removes is
  every *accidental* path: an ORM `save()`, a stray script, a careless `UPDATE` in
  psql.
- **Honest ceiling:** with one DB user and no WORM storage, in-database
  tamper-evidence is theatre — anyone who can write can rewrite a hash chain. Real
  tamper-evidence comes from §7.3 (Object Lock) and, optionally, mirroring critical
  rows to CloudWatch Logs.
- **Role snapshot at write time** is mandatory (§1). Requires a small addition to
  `role-access.guard.ts` to expose `user.roles` (slug + name) — it already queries
  `role_id`.
- **PII:** `pii_mode=mask` by default — phones/emails masked in payloads and diffs.
  You keep "the phone changed, roughly how" without duplicating the customer database
  into the audit table.

---

## 10. What the log unlocks (beyond forensics)

- **Record history** on menu items, roles, users, branch pricing (Phase 5).
- **Security alerts through the existing notifications catalog**
  (`notifications/notification-events.ts` is the single source of truth): burst of
  failed logins, permission escalation, first login from a new IP/device, spike in
  `outcome=denied`.
- **Cashier accountability** — voids, refunds, manual price overrides
  (`order_items.price_overridden` / `overridden_by` already exist), staff discounts,
  cash-outs, per person per shift.
- **Fraud patterns** — repeated overrides by one cashier, orders voided right after
  payment, discounts always applied at one till. A weekly anomaly digest.
- **PII access report** — who read customer contact details, and when.
- **Support forensics** — `request_id` correlation turns a complaint into a timeline.
- **Free APM-lite** — `duration_ms` percentiles per route.
- **Undo assistance** — show the previous value from a diff so it can be restored.
  (One-click revert is deliberately *not* in scope; it is its own risk surface.)

---

## 11. Verification & go/no-go gates

- **Unit:** `activity-log.redaction.spec.ts` asserting each known secret key is
  scrubbed at depth, and that a real admin branch response yields no `fbr_token`.
  ALS concurrency spec (two interleaved requests must not cross diffs). Policy spec
  for skip/allow lists. Partition-name/boundary spec. Archive round-trip spec
  (write → gzip → read back → deep-equal the original rows).
- **Integration:** hit a mutating endpoint → assert one row with correct
  actor/action/entity; hit an endpoint without permission → assert an
  `outcome='denied'` row exists (**the case an interceptor-only design would miss**);
  `POST /api/admin/upload` → assert no file buffer stored; login with a bad password
  → assert a row with no password in it; purge below the 90-day floor → assert
  refusal; purge with a wrong password → assert refusal + a logged attempt.
- **Live (dev DB):** run the real flows (open shift → cash-out → close; edit a menu
  price; change a role's permissions) and confirm the diffs read correctly;
  `npm run migration:run` then verify partitions via `\d+ activity_logs`; force the
  maintenance job dry-run, then for real, and confirm partitions are created,
  archived and dropped in that order.
- **Perf:** staging burst replay comparing p95 with `ACTIVITY_LOG_ENABLED` true vs
  false; confirm no pool exhaustion under simulated POS load.
- **Secret sweep before prod enable:** sample 200 rows and grep for `$2b$`, `eyJ`,
  `Bearer`, and known token field names. This query goes in the runbook.

**Go/no-go before enabling in prod:** migration rehearsed on a prod snapshot ·
secret sweep clean · p95 unchanged under load · kill switch tested in staging ·
archive round-trip verified · rollback rehearsed.

---

## 12. Verified anchors (2026-08-05)

| Reference | Plan said | Actual today |
|---|---|---|
| New migration number | `1760000000103` | ⚠️ **taken** — use `1760000000107`+ |
| `roles.service.ts` `updateRole` | L185 | **L207** (permission assign L247) |
| `role-access.guard.ts` super-admin short-circuit | L53 | **L57** |
| `consumer.controller.ts` `FileInterceptor` | L924 | **L927** |
| `CustomerInvoiceModal.tsx` auto-print | L285-295 | **L354-361**, and it fires **two** prints |
| `StockLedger.tsx` CSV export | L111 | **L121** |
| `Inventory.tsx` CSV export | L1101 | **L1153** |
| `.query()` bypass sites | 98 | **119** |
| `branches.service.ts` `fbr_token` echo | L181 | L181 ✓ |
| `app.module.ts` `ScheduleModule.forRoot()` | L75 | L75 ✓ |
| `customer.entity.ts` password, no `select:false` | L26 | L26 ✓ |
| `main.ts` `enableShutdownHooks()` | absent | absent ✓ |
| `upload.controller.ts` `FileInterceptor` | L25 | L25 ✓ |
| `utils/print.ts` sole funnel, 6 callers | 6 | 6 ✓ |
| Existing `APP_*` providers | none | none ✓ |
| `entities` with `updated_by` | 0 | **0 of 95** ✓ |
| `entities` with `updated_at` | — | **76 of 95** (so nothing to add) |

---

## 13. Flagged separately (do NOT fix here)

`role-access.guard.ts` compares `request.path` (which includes the `/api` global
prefix) against `PATH_REQUIRED_PERMISSIONS` entries starting `/admin` — **so that
path-level gate never matches and is currently inert**. All real enforcement comes
from `RequirePermissionGuard` method guards. Fixing it in this change would 403 a lot
of currently-working traffic. The activity log will make it visible: if anyone does
fix it, you will see an immediate `outcome=denied` spike.
