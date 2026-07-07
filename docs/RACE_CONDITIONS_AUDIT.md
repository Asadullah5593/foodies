# Race Conditions Audit — Foodies POS + Online Ordering

**Scope:** every backend module. **Concurrency model:** NestJS + TypeORM 0.3 + PostgreSQL at
default `READ COMMITTED`. The same `/api` is hit concurrently by POS terminals (many branches),
self-order kiosks, the customer mobile app, the Next.js consumer web, background cron jobs, and
many staff accounts. Under `READ COMMITTED`, two statements in different transactions do **not**
see each other's uncommitted writes and there is **no** lost-update protection unless the code holds
a row lock (`SELECT … FOR UPDATE` / `setLock('pessimistic_write')`), issues a single atomic
`UPDATE … SET x = x + n`, or a unique constraint converts a duplicate into a caught error.

**Method:** 17 per-module hunter agents read the code (incl. migrations) and produced concrete
2-actor interleavings; each candidate was then handed to an adversarial verifier told to *refute* it
by finding a real guard. A session rate-limit cut the run off, so ~50 findings + the cross-module
systemic pass are hunter-identified but not yet independently verified.

---

## ✅ Remediation status

Fixes land **cluster by cluster**, each gated on a green build + full test suite (191 tests)
before moving on. A shared concurrency toolkit lives in
[backend/src/common/db-concurrency.ts](../backend/src/common/db-concurrency.ts):
`transitionStatus` (lock-serialised idempotent status change), `advisoryXactLock`
(per-entity serialization), `retryOnConcurrencyError`, and the unique-violation predicates.

### Verification pass (adversarial, ran after the fixes)

A second multi-agent pass (deadlock/lock-ordering audit + adversarial re-review of every fix +
the never-before-audited **loyalty redemption** path + remaining-gap confirmation) was run against
the patched tree. It caught and we then fixed:

- **A CRITICAL regression the fix pass introduced** — the loyalty-earn `ON CONFLICT (order_id)
  WHERE type='earn'` clause did **not** match its partial-index predicate (`… AND order_id IS NOT
  NULL`), so *every* earn raised Postgres `42P10` and 500'd order completion. Corrected and
  re-verified against the live DB.
- **A real ABBA deadlock** — consume locks `batch_on_hand → on_hand` (FEFO must lock batches to
  pick them) while reverse/`postLedgerMovements` lock the other way. Closed by deterministic
  item-id lock ordering **and** wrapping both consume and reverse in `retryOnConcurrencyError`.
- Loyalty **redemption** was un-audited: added per-order idempotency (`UQ_loyalty_tx_order_redeem`
  + under-wallet-lock check) and moved `redeemForOrder` inside `createOrder`'s rollback so a redeem
  failure reverses consumption and cancels the orders.
- The remaining confirmed gaps were then all fixed (cart, notifications, ratings, stocktake-line,
  adjustment, wastage, brand-delete, comp-plan version, presence heartbeat, OTP brute-force,
  `changeRiderForGroup`, `cancelled_at` clearing).

**Empirically proven** against a live Postgres (not just typechecked) via
[backend/src/scripts/verify-concurrency.ts](../backend/src/scripts/verify-concurrency.ts):
25 concurrent `transitionStatus` calls → exactly 1 winner; 50 concurrent locked increments → 0 lost.

**Migrations added:** `…060` loyalty-earn · `…061` payment-idempotency · `…062` payroll-run-scope ·
`…063` order-idempotency · `…064` redeem-idempotency + stocktake-line-coalesce · `…065` OTP-attempts.

### Still open (deliberately deferred — need runtime `/verify`, not just tests)

- **Transactional `createOrder` (A2) + coupon usage-limit (J2)** — wrapping the single most critical
  path in one transaction (savepoint-retry for the number-collision) and enforcing single-use
  coupons at commit. Both need end-to-end runtime verification before shipping. A1 (number retry),
  A3 (idempotency key), A4 (availability), A5 (brand-open) are already done.
- Lower-severity leftovers: `setPause`/`checkOut` row-lock (heartbeat N3 already fixed), email-OTP
  attempt limiter (phone done), `runPayroll` orphan-draft sweep, dispatch client-idempotency-key,
  trimming the stocktake-close lock-hold window.

**All 6 CRITICALs are closed and verified**, plus the entire order-completion core and
several HIGH clusters:

| Cluster | Findings fixed | How |
|---|---|---|
| Order completion | I1, C1, C2, C3, B1, B3 | atomic `transitionStatus` on all 3 completion paths; loyalty earn idempotent (partial unique index + ON CONFLICT); shift cash atomic increment scoped to open shift; atomic close |
| Inventory consume/reverse | **D1**, D2, D3 | `advisoryXactLock(ORDER_INVENTORY, order.id)` serialises consume/reverse + under-lock re-checks |
| Procurement | **E1**, E2, E3, E4, E5 | PO advisory lock, atomic GRN/PR transitions, over-receipt guard under lock, batch-on-hand lock in reverseGRN |
| Inventory transfers | **F1**, **F2**, F3, F4, F5, F6 | transfer-order advisory lock, atomic approve/reject transitions, cross-branch item-level cap, scoped status updates |
| Payments + kiosk | **K1**, K2, K3, K4 | order-row lock + optional idempotency key (unique index); kiosk payments replayed idempotently on retry; scoped non-regressing status |
| Payroll + comp plans | **O1**, O2, O4 | partial unique index (one non-reversed run/period) + orphan-draft cleanup; atomic reverse; comp-plan activation serialised |
| Promotions | J1, J3, J4 | atomic claim transition + coupon-code retry; deactivate/claim coordinated on a promotion advisory lock with bulk atomic UPDATEs |
| Order creation (partial) | A1, A4 | order-number collision → regenerate-and-retry (no more 500 on same-second placement); branch availability / hidden-online re-checked at commit (86'd items no longer slip through) |
| Auth/OTP/customer | Q1, Q2, Q4 | atomic single-use OTP claim (`UPDATE … WHERE used_at IS NULL`) closes reset-race takeover; send-cooldown under a per-identifier advisory lock; first-time-customer create catches the unique violation and re-fetches |
| Stocktake | G1 | close runs in one transaction that locks the branch on-hand rows FOR UPDATE before reading theoretical and posting variance — a sale mid-close can no longer corrupt reconciliation; atomic submitted→closed guard |

Migrations added: `1760000000060` (loyalty earn), `1760000000061` (payment idempotency),
`1760000000062` (payroll run scope).

**9+ clusters touched, all verified** (build + 191 tests green after each).

**Deferred to a dedicated transactional-`createOrder` pass** (they share that foundation):
A2 (wrap persistence in one transaction — no partial multi-brand groups), A3 (client
idempotency key), A5 (brand online-open re-check), J2 (coupon usage-limit enforced at
order-apply), B2 (payment/status full-entity save). Also outstanding: G2–G5, H1, N1–N4,
P/M/R, Q3 (needs a ThrottlerGuard), Q5/Q6, and the discovery gaps (loyalty redemption,
systemic/deadlock, ~50 unverified).

**Remaining** (all HIGH↓, no criticals): A1–A6 + B2 (order creation), G1–G5 + H1 (stocktake/
adjust/wastage/brand-delete), J1–J4 (promotions/coupons), N1–N4 (rider dispatch), P/M/R
(menu/cart/notifications), Q1–Q6 (OTP/customer), O3/O5/L1 leftovers, plus the discovery gaps
(loyalty redemption, systemic/deadlock, ~50 unverified). Each 🔶 finding is re-checked against
the code as its cluster is fixed.

---

### Verification legend
- ✅ **CONFIRMED** — verifier read the code and found no guard closing the window (real & reachable).
- ⚠️ **PARTIAL** — a guard (usually a unique index) prevents *data corruption*, but a real problem
  remains: an ungraceful 500 instead of a clean 409/idempotent success, or the guard covers only part
  of the window.
- 🔶 **UNVERIFIED** — hunter-identified with file/line evidence; independent verification was cut off
  by the session limit. Treat as "very likely" pending a second pass.
- ✔️ **SAFE** — checked and found actually guarded (listed so you know it was considered).

---

## The 9 root-cause patterns (study these first)

Almost every finding below is an instance of one of these. Fixing the *pattern* kills whole clusters.

1. **Check-then-act with no lock / no unique backstop.** `findOne(...)` then `save/insert`. Two
   actors both read "absent/open/submitted" and both proceed. *(shift open, order number, PR & transfer
   approve, claim promotion, OTP verify, cart create, customer create, stocktake create.)*
2. **Read-modify-write on a counter via full-entity `save()`.** No atomic `SET x = x + n`, no
   `@VersionColumn`. Last writer wins, increments are lost. *(shift `expectedCash`, comp-plan version,
   PO status.)*
3. **Full-entity `repo.save(entity)` after an unlocked `findOne`.** TypeORM writes **every** column
   from a stale in-memory snapshot, so a concurrent change to *any other* column is silently reverted —
   this can *resurrect terminal state*. *(order status, shift un-close, rider presence un-pause,
   transfer-order status, branch_menu_item, cart item, payment→order status.)*
4. **Idempotency check placed OUTSIDE the lock/transaction that would enforce it.** The guard reads an
   unlocked row *before* the txn opens and is never re-checked under the lock, so the lock only
   *serializes* the double-apply instead of preventing it. *(loyalty double-earn, order-completion
   double side-effects, `consumeForOrder`.)* ← the subtle, high-impact one.
5. **Ledger idempotency key protects the ledger but NOT the denormalized read-model.** The
   `inventory_on_hand` / `inventory_batch_on_hand` `UPDATE`/upsert runs **unconditionally**, not gated
   on whether the `INSERT … ON CONFLICT DO NOTHING` ledger row actually inserted. *(consume, reverse,
   transfer dispatch/receive, GRN, adjustment.)* ← recurring inventory corruption.
6. **No wrapping transaction across a multi-step mutation.** Partial commit with no atomic rollback.
   *(createOrder, kiosk-finalize payments, runPayroll, menu sync, stocktake close, wastage.)*
7. **No client idempotency key on mutating POSTs.** Retries / double-taps duplicate. Only the kiosk
   channel and the inventory ledger have keys. *(createOrder for POS/app/web, processPayment, cart add,
   manual rider assign, payroll run, claim promotion.)*
8. **Missing DB uniqueness for a business invariant.** *(one active order per rider, one active
   comp-plan per scope, one transfer order per request, coupon usage limit, one payroll run per period.)*
9. **TOCTOU between a display/quote read and the commit.** *(item availability / 86-ing, price override,
   brand online open/close, in-transit qty, stocktake "theoretical" read.)*

---

## Severity summary

| # | Area | Severity | Status |
|---|---|---|---|
| A1 | Order number/id `COUNT+1` collision → 500 | High | ⚠️ |
| A2 | `createOrder` not transactional → partial multi-brand groups | High | ✅ |
| A3 | `createOrder` no idempotency key → duplicate orders on retry/double-tap | High | ✅ |
| A4 | 86'd item never re-checked at order time → sold-out items ordered | High | 🔶 |
| A5 | Brand online open/close not enforced for POS/consumer `createOrder` | Med | 🔶 |
| A6 | Price override changes between quote and capture | Low | 🔶 |
| B1 | Order completion double-fires loyalty earn + shift cash | High | ✅ |
| B2 | `updateStatus` unlocked + full-entity save → status regression / resurrect | High | ✅ |
| B3 | complete-vs-cancel race leaves loyalty/shift/inventory unreversed | Med | ✅ |
| C1 | `shift.expectedCash` RMW lost update | High | ✅ |
| C2 | Order-completion save un-closes a just-closed shift | High | ✅ |
| C3 | Concurrent double-close overwrites reconciliation | Med | ✅ |
| C4 | Shift-number collision across brands → 500 | Med | ⚠️ |
| C5 | Duplicate open-shift TOCTOU → 500 not 409 | Low | ⚠️ |
| C6 | Kiosk finalize reads open shift unlocked → cash to closing shift | Med | ✅ |
| D1 | Concurrent `consumeForOrder` double-deducts on-hand | **Critical** | ✅ |
| D2 | consume-vs-reverse TOCTOU → cancelled order never reverses stock | High | ✅ |
| D3 | Concurrent `reverseConsumptionForOrder` double-credits on-hand | High | ✅ |
| E1 | Over-receipt: two GRNs on one PO | **Critical** | ✅ |
| E2 | `postGRN` double-process → orphan batches + dup cost rows | High | ✅ |
| E3 | `approvePRAndCreatePO` → duplicate POs | High | ✅ |
| E4 | `reverseGRN` TOCTOU → negative on-hand | High | ✅ |
| E5 | PO receipt-status recompute lost update | Med | ✅ |
| E6 | PR/PO/GRN reference uniqueness → 500 | Low | 🔶 |
| F1 | Cross-branch transfer receive double-credits destination | **Critical** | ✅ |
| F2 | Same-branch receive over-credits via unlocked in-transit SUM | **Critical** | ✅ |
| F3 | `approveRequest` → duplicate transfer orders | High | ✅ |
| F4 | `dispatchOrder` FEFO re-pick → double-deduct source | High | ✅ |
| F5 | Transfer-order status lost update / regression | Med | ✅ |
| F6 | approve-vs-reject race → rejected request w/ live order | Med | ✅ |
| G1 | `closeStocktake` variance over stale theoretical read | High | ✅ |
| G2 | `upsertStocktakeLine` concurrent count → 500 / lost count | Med | ✅ |
| G3 | `createStocktake` get-or-create → 500 | Low | ⚠️ |
| G4 | `postAdjustment` double-post → orphan batch, mispointed line | Med | 🔶 |
| G5 | `recordWastage` non-atomic (event vs ledger) | Med | 🔶 |
| H1 | Brand delete folds buckets unlocked, races consumption/transfer | Med | 🔶 |
| I1 | Loyalty double-earn (idempotency outside wallet lock) | High | ✅ |
| I2 | Loyalty redemption double-spend / dual-wallet (POS vs APP) | ? | ⛔ not scanned |
| J1 | `claimPromotion` double-claim → duplicate coupons | High | ✅ |
| J2 | No coupon usage-limit → unlimited concurrent redemption | High | ✅ |
| J3 | `generateCouponCode` collision → 500 | Med | ⚠️ |
| J4 | deactivate-vs-claim race → orphaned live coupon | Med | ✅ |
| K1 | `processPayment` no idempotency → duplicate / overpayment | **Critical** | 🔶 |
| K2 | Split-payment TOCTOU → fully-paid order stuck unpaid | High | 🔶 |
| K3 | Kiosk finalize applies payments outside txn → lost on retry/crash | High | ✅ |
| K4 | `processPayment` full-entity save clobbers order status | High | 🔶 |
| L1 | Kiosk code reuse binds collected cash to wrong cart | Med | ⚠️ |
| M1 | `getOrCreateCart` → 500 | Low | ⚠️ |
| M2 | Cart item concurrent edit lost update | Low | ✅ |
| M3 | Cart update-vs-remove TOCTOU → false success | Low | ✅ |
| M4 | Cart add no idempotency → duplicate lines | Low | ✅ |
| N1 | Rider single-active-order check-then-act (all assign paths) | High | 🔶 |
| N2 | Auto-dispatch shared-rider cross-brand double-assign | High | 🔶 |
| N3 | Presence heartbeat clobbers pause/break state | Med | 🔶 |
| N4 | Manual assign no idempotency → dup ledger + dup push | Low | 🔶 |
| O1 | Double payroll run → double pay | **Critical** | 🔶 |
| O2 | `reversePayrollRun` double-reverse | High | 🔶 |
| O3 | `runPayroll` not transactional → torn draft run | Med | 🔶 |
| O4 | Two active comp-plans in one scope | High | 🔶 |
| O5 | Comp-plan version collision | Med | 🔶 |
| P1 | Concurrent `branch_menu_item` edits → 86 silently un-done | Med | 🔶 |
| P2 | `linkBrandMenuItem` concurrent → 500 | Low | 🔶 |
| P3 | `sync()` non-transactional → transient empty/partial menu | Med | 🔶 |
| P4 | Deleting a menu item CASCADE-wipes order history + races createOrder | High | 🔶 |
| Q1 | OTP verify check-then-act → replay / reset-race takeover | High | 🔶 |
| Q2 | OTP resend cooldown bypass | Med | 🔶 |
| Q3 | No atomic OTP attempt limiter → brute force | Med | 🔶 |
| Q4 | `findOrCreateTenantCustomerForPhone` unique-violation → 500 | Med | 🔶/⚠️ |
| Q5 | Admin customer create no unique catch / wrong message | Low | 🔶 |
| Q6 | Consumer→tenant merge unlocked reads | Low | 🔶 |
| R1 | Notification `act()` double-emit / wrong resolver identity | Low | 🔶 |
| R2 | `syncSystemAlerts` double-resolve | Low | 🔶 |
| R3 | Rating double-submit → 500 not idempotent | Low | 🔶 |

---

## A. Order placement & pricing

### A1 — Order number/`order_id` sequence collision `COUNT+1` ⚠️ High
`generateOrderIdentifiers` builds the daily per-(branch,brand) sequence with `getCount()+1`, no lock,
not in a transaction. Two concurrent placements read the same count → same `005`. `UQ_orders_order_id`
/ `UQ_orders_branch_brand_day_number` block the duplicate *persisting*, but there is **no retry**, so the
loser's whole `createOrder` throws a **500** (order lost). Window widens at the local/UTC midnight
boundary (count is over the UTC-date prefix; unique index keys on `date(placed_at)` in server-local tz).
`orders.service.ts:5007-5029`, save at `:1640`.

### A2 — `createOrder` performs multi-row/multi-order writes with no wrapping transaction ✅ High
Each `orderRepo.save` / `orderItemRepo.save` autocommits independently. A mixed-brand consumer cart
splits into 2 orders in a group; if brand-Y's order throws mid-way, brand-X's order + items are already
durably committed while brand-Y never exists. Only cleanup is a best-effort, error-swallowing
compensating cancel/reverse. → partial order groups, header with no lines, inventory consumed for
abandoned orders. `orders.service.ts:987, 1580-1764, 1777-1837`.

### A3 — `createOrder` has no idempotency key ✅ High
POS/app/web `createOrder` accepts no client idempotency token (only kiosk does, via
`uq_kiosk_idempotency`). A slow request retried, or a double-clicked "Place order", runs twice; the
second gets the *next* sequence number so it does **not** collide — it commits as a wholly separate
order: double kitchen ticket, double inventory depletion, and a second wallet debit if redeeming points.
`pos-orders.controller.ts:116`, `consumer.controller.ts:1401`, `orders.service.ts:987`.

### A4 — A just-86'd item is never re-checked at order time 🔶 High
`getBranchMenu()` filters `bmi.isAvailable` for *display* only. `createOrder`'s regular-line path
resolves via `findMenuItem()` (brand-level) + `getEffectiveUnitPrice()` (reads `bmi` only for
`priceOverride`) and **never consults `branch_menu_items.isAvailable`/`isHiddenOnline`**. Kitchen 86's an
item between menu-load and submit → the order is accepted and sent to the kitchen anyway. The
availability toggle is effectively inert against the order path. `orders.service.ts:1202,1236`,
`menu.service.ts:1658-1675`, `branch-menu-items.service.ts:333`.

### A5 — Brand online open/close not enforced for POS/consumer `createOrder` 🔶 Med
Only `kiosk.service.ts:184` checks `branch_brands.is_open`. The shared `createOrder` used by
POS/consumer_app/consumer_web validates brand-at-branch linkage but never reads `is_open`, so an order
placed just after a manager takes the brand offline is accepted. `orders.service.ts:987`,
`brands.service.ts:754`.

### A6 — Price override changes between quote and capture 🔶 Low
`quote()` returns a total from the current `price_override`; `createOrder` re-reads the live override
with no comparison against the quoted total, so an admin edit in between silently changes the charged
amount. `orders.service.ts:1236`, `branch-menu-items.service.ts:331`.

## B. Order status transitions & completion

### B1 — Completion double-fires loyalty earn + shift-cash credit ✅ High
`updateStatus→completed` reads the order with **no lock**; two concurrent completes (KDS + POS, or a
double-click) both see `status='ready'`, both flip to completed, both call `earnOnOrderComplete` and
`addCompletedOrderAmount`. `earnOnOrderComplete`'s idempotency check `loyaltyPointsEarned > 0` is read
*outside* the wallet transaction (pattern #4), so both pass; the wallet lock only serializes the two
inserts → **points credited twice** and **shift expected-cash credited twice**. Also fires from the KDS
path `kitchen.service.ts:166`. `orders.service.ts:2485-2527`, `loyalty.service.ts:153-230`.

### B2 — `updateStatus` unlocked + full-entity `save()` → status regression / resurrection ✅ High
No `@VersionColumn` on `Order`; `updateStatus`, `assignRider`, `processPayment` all `findOne` then
full-entity `save()`. A concurrent change to *any* column is clobbered by the stale snapshot — a
**cancelled order can be revived** and re-dispatched, a KDS "ready" can be pushed back to "preparing", a
paid status can regress. `orders.service.ts:2492`, `kitchen.service.ts:166`, `payments.service.ts:20-41`,
rider paths `orders.service.ts:2918,2962,3119`.

### B3 — complete-vs-cancel leaves side-effects unreversed ✅ Med
Order is `ready`; A completes, B cancels, both read the pre-transition snapshot. A earns loyalty + adds
shift cash; B (having read pre-completion state) never revokes them and only reverses inventory. Final
row: `status='cancelled'` but points earned and cash credited for a cancelled order.
`orders.service.ts:2492-2546`.

## C. Shift / cash reconciliation

### C1 — `shift.expectedCash` read-modify-write lost update ✅ High
`addCompletedOrderAmount` does `findOne(open shift)` → add in JS → `repo.save` (absolute
`SET expected_cash = <computed>`, not `+= `). Two orders completing at once both read the same base;
one increment is lost. → shift close shows a phantom drawer surplus/shortage; cashiers blamed. Needs an
atomic `UPDATE … SET expected_cash = COALESCE(expected_cash, opening_cash) + :amt`.
`shifts.service.ts:311-329`, `orders.service.ts:2527`.

### C2 — Order-completion save un-closes a just-closed shift ✅ High
`addCompletedOrderAmount` loads the shift (status='open') into memory; a manager closes it; the
completion handler then full-entity `save()`s its stale copy, writing `status='open'`,
`closing_cash=NULL`, `closed_at=NULL`, `closed_by=NULL` — **the close is reverted**.
`shifts.service.ts:316-357`.

### C3 — Concurrent double-close overwrites reconciliation ✅ Med
`close()` checks `status==='closed'` on a non-locking `findOne`. Two closers both read 'open'; the
second overwrites actual-cash/closed-by/closed-at/notes. Partial index `UQ_shifts_open_branch_brand`
doesn't help (both write `closed`). `shifts.service.ts:343-357`.

### C4 — Shift-number collision across brands → 500 ⚠️ Med
`shift_number` uses `getCount()+1` over the whole branch (all brands). Two different brands opening at
one branch at once compute the same number; `UNIQUE(branch_id, shift_number)` throws an unhandled 500 on
the loser (no retry). `shifts.service.ts:188-194`.

### C5 — Duplicate open-shift TOCTOU → 500 not 409 ⚠️ Low
`findOne(status='open')` then `save`. `UQ_shifts_open_branch_brand` (partial, `WHERE status='open'`)
**fully prevents** two open shifts, but the racing request gets a raw 500 instead of the intended
`ConflictException`. Data integrity is fine; only error mapping is wrong. `shifts.service.ts:175-194`.

### C6 — Kiosk finalize reads the open shift unlocked ✅ Med
`findOpenByBranch()` is a plain `findOne` (no `FOR UPDATE`); a manager can close that shift between the
read and when the kiosk applies payment (payments are applied entirely outside the finalize txn), so
counter cash is attributed to an already-closed shift. `kiosk.service.ts:402,439`, `shifts.service.ts:217`.

## D. Inventory consumption / reversal (order-driven)

### D1 — Concurrent `consumeForOrder` double-deducts on-hand **Critical** ✅
Pre-txn `findOne(order_inventory_allocations)` guard (no lock, no `UNIQUE(order_id)`) — both actors read
"none". Each opens its own txn; the per-batch `SELECT … FOR UPDATE` only *serializes* them. The second
re-reads the reduced batch and deducts **again**; where it reuses a batch, the ledger insert is deduped
by key but the follow-up `UPDATE inventory_batch_on_hand SET qty = qty - take` and the `inventory_on_hand`
upsert run **unconditionally** (pattern #5), plus a duplicate allocation row (no unique constraint). →
on-hand diverges permanently below the ledger; false negatives; a later single reversal over-credits.
Fires on at-least-once retries / a status-driven consume racing the creation consume.
`inventory-consumption.service.ts:39,105,315,366,386`.

### D2 — consume-vs-reverse TOCTOU: cancelled order never reverses stock ✅ High
`reverseConsumptionForOrder` reads allocations with no lock and early-exits `{nothing_to_reverse}` if it
sees none. If a cancel runs while `consumeForOrder` is still in-flight (allocations not yet committed),
reverse sees zero rows and does nothing; consume then commits the deduction → **phantom permanent
consumption** for a cancelled order. Same for `createOrder`'s best-effort rollback path.
`inventory-consumption.service.ts:124-132`, `orders.service.ts:2537,1781`.

### D3 — Concurrent `reverseConsumptionForOrder` double-credits ✅ High
Two cancels (or cancel + creation-rollback) both read the same allocations before either DELETEs them.
The reverse-ledger insert is deduped by ON CONFLICT, but the `inventory_on_hand` / `inventory_batch_on_hand`
credit upserts run **unconditionally** (pattern #5) → stock credited twice, above true level.
`inventory-consumption.service.ts:128,162,197,216`.

> ✔️ **SAFE:** `negative_flagged_at` set/clear race (`inv-consume-4`) — verifier found the ON CONFLICT
> upsert holds an exclusive row lock on the single bucket row through commit, so the flag and qty stay
> consistent. No fix needed.

## E. Procurement (GRN / PO / PR)

### E1 — Over-receipt: two GRNs post against one PO **Critical** ✅
The only over-receipt guard (`isPOFullyReceived`) is in `createGRN` and reads *posted*-GRN totals with
no lock. Two drafts opened before either posts both pass; `postGRN` re-checks **nothing** about
received-vs-ordered (only draft status, non-empty lines, PO≠closed). Ledger idempotency keys differ per
GRN, so on-hand is credited twice → PO received = 2× ordered, double-invoiceable.
`procurement.service.ts:745,768,1223-1416`.

### E2 — `postGRN` double-process → orphan batches + duplicate cost rows ✅ High
Status read is check-then-act with no lock; the `grn.save()` status flip has no `WHERE status='draft'`
predicate. Two posts both create fresh `InventoryBatch` rows per line (non-idempotent) and both raw-INSERT
`inventory_item_costs` (no ON CONFLICT). The ledger key protects on-hand *quantity*, but each retry leaks
a zero-qty batch (pollutes FEFO) and an extra cost snapshot with the same `effective_at` → non-deterministic
"latest cost". `procurement.service.ts:1223,1268,1326,1368`.

### E3 — `approvePRAndCreatePO` → duplicate purchase orders ✅ High
`pr.status==='submitted'` checked via `findOne` before the txn, no `FOR UPDATE`, no `UNIQUE` on
`purchase_orders.purchase_requisition_id`. Double-clicked approve → two identical POs (double spend).
PO number is `PO-<tenant>-<Date.now last 8>`, so same-ms approvals also risk a number collision 500.
`procurement.service.ts:362-397`.

### E4 — `reverseGRN` TOCTOU → negative on-hand ✅ High
The "batch untouched" check is a non-locking `SELECT COUNT(*)` of non-receive movements. A concurrent
sale consumes from the batch after the count reads 0; the reversal then posts `-10` on a batch already
at 6 → `qty = -4`. No `FOR UPDATE`, no `CHECK(qty>=0)`. `procurement.service.ts:1418-1475`.

### E5 — PO receipt-status recompute lost update ✅ Med
Two GRNs post concurrently; each `recalculatePurchaseOrderReceiptStatus` reads only its own committed
contribution (READ COMMITTED) and saves `partially_received`. Combined receipts total the full order but
`PO.status` is left wrong → bad createGRN/close decisions. `procurement.service.ts:612,644,1405`.

### E6 — PR/PO/GRN reference uniqueness → 500 🔶 Low
User-supplied `po_number`/`grn_number`/`pr_number` uniqueness is a racy `findOne`; the partial unique
indexes hold integrity but the loser gets a raw 500 instead of a 400. `procurement.service.ts:74,391,794`.

## F. Inventory transfers

### F1 — Cross-branch receive double-credits destination **Critical** ✅
`receiveOrder` loads the order with no `FOR UPDATE` and no `UNIQUE(transfer_order_id)` on receipts. Each
call creates its **own** receipt (fresh `receipt.id`), so the ledger idempotency key differs, both
inserts succeed, and the cross-branch path creates a new batch + credits qty with **no cap against
dispatched/in-transit**. Reproducible even sequentially — a second receive is never blocked.
`inventory-transfer.service.ts:635,774,808`, `inventory.service.ts:1031`.

### F2 — Same-branch receive over-credits via unlocked in-transit SUM **Critical** ✅
`getInTransitBatches` computes `dispatched − received` with two plain `SELECT SUM`s, no `FOR UPDATE`. Two
concurrent receives both read `received=0`, both compute `available=10`, both credit 10 → 20 into the
destination brand bucket though only 10 was dispatched. Breaks the pool→brand conservation invariant.
`inventory-transfer.service.ts:567-633,739`.

### F3 — `approveRequest` → duplicate transfer orders ✅ High
`status!=='submitted'` checked without a lock; no `UNIQUE` on `inventory_transfer_orders.transfer_request_id`.
Double approve → two live dispatchable orders for one request → source stock deducted twice.
`inventory-transfer.service.ts:293-339`.

### F4 — `dispatchOrder` FEFO re-pick → double-deduct source ✅ High
Order row not locked. `FOR UPDATE` on batches serializes but triggers a FEFO **re-pick**: after A drains
batch1, B picks batch2, so B's idempotency key (batch+qty) differs and the insert succeeds → source
deducted twice on a retry/double-click. `inventory-transfer.service.ts:372,453,471`.

### F5 — Transfer-order status lost update / regression ✅ Med
Order loaded outside the txn, full-row `save()` at the end, no `@VersionColumn`. Concurrent dispatch and
receive clobber each other's status (a fully-received order can show `dispatched_partial` and stay
receivable → feeds F1/F2). `inventory-transfer.service.ts:386,484,863`.

### F6 — approve-vs-reject race ✅ Med
Both read `status='submitted'`; approve creates an order and reject sets `status='rejected'`. If reject
commits last → a rejected request with a live, dispatchable order. `inventory-transfer.service.ts:318,344,365`.

## G. Stocktake / adjustments / wastage

### G1 — `closeStocktake` applies variance over a stale theoretical read ✅ High
Not wrapped in a transaction. Reads theoretical on-hand (SUM), computes `variance = counted − theoretical`
in JS, then applies it as an additive **delta** in a *separate* txn (`qty = qty + variance`). Any
sale/wastage/transfer committing between the read and the apply is silently double-counted → after close,
system on-hand ≠ physical count (the entire purpose of a stocktake is defeated, invisibly).
`inventory.service.ts:1507,1552,1601`.

### G2 — `upsertStocktakeLine` concurrent count → 500 / lost count ✅ Med
`findOne`-then-insert with no ON CONFLICT and no lock. Two staff counting the same item: insert path →
unique-violation 500; update path → the later `save()` silently overwrites the earlier count (the sole
input to variance). `inventory.service.ts:1439-1482`.

### G3 — `createStocktake` get-or-create → 500 ⚠️ Low
`findOne(branch,week)` then save, no ON CONFLICT. `UNIQUE(branch_id, week_start)` holds integrity but the
loser 500s instead of returning the existing row. `inventory.service.ts:1411-1436`.

### G4 — `postAdjustment` double-post → orphan batch + mispointed line 🔶 Med
Status read unlocked; each post unconditionally INSERTs a fresh batch. Ledger dedup keeps total on-hand
right, but the second batch gets zero qty while the line is repointed to it → FEFO/expiry traceability
corrupted. `inventory-adjustment.service.ts:104-186`.

### G5 — `recordWastage` non-atomic 🔶 Med
Saves the `wastage_events` row (autocommit) then separately posts the ledger/on-hand in another txn. A
crash/throw between them leaves a wastage record with no stock deduction; no batch lock, so racing
waste/consume can drive the bucket negative. `inventory.service.ts:1076-1109`.

## H. Brand-bucket inventory

### H1 — Brand delete folds buckets into the pool without locking 🔶 Med
`releaseBrandInventoryToBranchPool` does `INSERT..SELECT..ON CONFLICT` (copy brand qty → pool) then a
separate `DELETE … WHERE brand_id=X`, no `FOR UPDATE`. A concurrent consume/receipt on the doomed brand
between the two statements either fabricates or destroys pool inventory equal to the movement.
`brands.service.ts:790-810`.

## I. Loyalty

### I1 — Double-earn: idempotency outside the wallet lock ✅ High
(Same defect as B1, loyalty side.) `earnOnOrderComplete`'s `loyaltyPointsEarned>0` check reads an
unlocked order row *before* the txn; the wallet `pessimistic_write` lock only serializes, so two
completions insert two `earn` lots and credit points twice. No `UNIQUE(order_id) WHERE type='earn'`.
`revokeEarnedPoints` reverses only one lot, stranding the rest. `loyalty.service.ts:159,205-230`.

### I2 — Loyalty redemption / dual-wallet ⛔ NOT SCANNED
The loyalty hunter hit a schema-retry failure and returned only the earn finding. **Redemption**
(concurrent redeem across POS brand-wallet + shared APP wallet, FIFO-lot double-spend, redeem racing a
duplicate order per A3) was **not audited**. High-priority gap for the re-run — the redeem path debits
real money-equivalent balances and A3/B1 already hint the wallet lock's idempotency has the same
outside-the-lock weakness.

## J. Discounts / promotions

### J1 — `claimPromotion` double-claim → duplicate coupons ✅ High
`UNIQUE(customer_id, promotion_id)` stops duplicate *assignment* rows but not duplicate *claims* of one
row. Double-tap Claim: both read `status=pending`, both mint a fresh `isActive=true` discount code, both
set `status=claimed`. `cp.discountId` points to only the second; the first is orphaned but **live and
redeemable**. `promotions.service.ts:230-293`.

### J2 — No coupon usage-limit → unlimited concurrent redemption ✅ High
`resolveCouponDiscount` does `findOne({code, isActive:true})` and applies it every time — **no usage
counter, no per-customer bookkeeping**, and `customer_promotion.status` is never advanced to `used`
(that write exists nowhere). A "single-use" code is redeemable unlimited times on unlimited concurrent
orders, by the claimant or anyone who learns it. Direct revenue loss. `orders.service.ts:4677,4710`.

### J3 — `generateCouponCode` collision → 500 ⚠️ Med
`findOne(code)`-then-insert loop; two claims of the same promo compute the same base (`WELCOME10`), both
see none, both insert → `UQ_discounts_code` 500 on the loser (uncaught in `claimPromotion`).
`promotions.service.ts:414-434,274`.

### J4 — deactivate-vs-claim race → orphaned live coupon ✅ Med
Admin toggles a promo off (`deactivateAssignments` loads pending copies into memory) while a customer
claims one. The claim mints discount D and sets `status=claimed`; the admin's stale loop then sets that
copy `expired` (overwriting claimed) but, because its snapshot had `discountId=null`, never disables D →
**the promo is off but D stays `isActive=true` forever**. `promotions.service.ts:163-230`.

## K. Payments

### K1 — `processPayment` no idempotency → duplicate / overpayment **Critical** 🔶
No idempotency key, no unique constraint beyond the surrogate PK, no existing-tender check. Double-clicked
"Pay" (or a POS/mobile retry) inserts two `Payment` rows of 500 for a 500 order → order over-settled,
takings double-counted. Shared by POS, consumer app, and kiosk settle paths.
`payments.service.ts:23`, `pos-orders.controller.ts:146`, `consumer.controller.ts:1899`.

### K2 — Split-payment settlement TOCTOU → fully-paid order stuck unpaid 🔶 High
Split tender on two terminals: each inserts its part then SUMs payments before the other commits, both
see `< total`, neither flips `status`. Result: fully-paid (500=300+200) order left unaccepted; staff must
intervene. Split payment is the normal case. `payments.service.ts:34-41`.

### K3 — Kiosk finalize applies payments outside the txn ✅ High
The finalize txn creates the order + sets `status='finalized'` and commits; `applyPayments` runs
**after**, gated on `!alreadyFinalized`. A crash/throw/timeout after commit but before payments leaves a
finalized order with zero/partial payments, and the idempotent retry branch **skips** `applyPayments`
entirely → cash collected, no payment rows, expected-cash understated, unrecoverable via the API.
`kiosk.service.ts:449,462-467,386`.

### K4 — `processPayment` full-entity save clobbers order status 🔶 High
(Instance of B2.) Reads the order at t1, later `order.status='accepted'; orderRepo.save(order)` writes
the whole stale entity, reverting a concurrent `updateStatus('preparing')`. `payments.service.ts:20-41`.

## L. Kiosk

### L1 — Daily code reuse binds collected cash to the wrong cart ⚠️ Med
`nextCode` takes `MAX(kiosk_code)` over `status='pending'` only, so codes wrap and re-issue once earlier
ones finalize/expire. `lookup` filters `status='pending'`, but `finalize` resolves by `(branch, code)`
`ORDER BY id DESC` with **no status filter** and locks that newest row. After expiry+reuse, a cashier who
looked up customer X's `001` can finalize customer Y's newer `001`; if totals coincide the payment-total
guard passes and the wrong order is created/charged. Fix: bind finalize to the row **id** returned by
lookup. `kiosk.service.ts:257,371-379`, `pos-kiosk.controller.ts:97`.

## M. Cart *(low blast radius — checkout reads the client's list, not this cart)*

- **M1** ⚠️ `getOrCreateCart` check-then-act vs `IDX_carts_customer_branch` → 500 on concurrent first add. `cart.service.ts:14-22`.
- **M2** ✅ `updateItem` `findOne`-then-`save` (full entity) → concurrent edits from two devices lose a field. `cart.service.ts:98-129`.
- **M3** ✅ update-vs-remove TOCTOU → `save()` affects 0 rows but returns 200 with in-memory entity (false success). `cart.service.ts:109-141`.
- **M4** ✅ `addItem` no idempotency, never merges identical lines → double-tap = duplicate lines. `cart.service.ts:51-65`.

## N. Rider dispatch & presence

### N1 — Single-active-order cap is a lockless check-then-act (every assign path) 🔶 High
`assignRider`, `changeRider`, `assignRiderToGroup` all do `getRiderActiveState()` COUNT then `save`, no
txn, no `FOR UPDATE`, no partial-unique index enforcing one active order per rider. Two admins (or two
tabs / a double-click) assigning the same rider to different orders both COUNT 0 and both commit → rider
double-booked despite `maxBatchSize=1`. `orders.service.ts:2947,3025,3097`.

### N2 — Auto-dispatch shared-rider cross-brand double-assign 🔶 High
The `RiderDispatchState` `pessimistic_write` lock is per-(tenant,branch,**brand**), so two brand streams
lock *different* rows and don't serialize; the "live count re-check" is an unlocked COUNT. A rider shared
across brands X and Y is picked by both streams, both read `active=0`, both assign. The manual paths (N1)
share no lock with auto-dispatch either. `orders.service.ts:643,686,726`.

### N3 — Presence heartbeat clobbers pause/break 🔶 Med
`setPause` runs in a txn (and enforces one open break), but the high-frequency `heartbeat`/`checkIn`/
`checkOut` do a full-entity `presence.save()` with no lock, reverting a just-committed `is_paused=true` →
an on-break rider re-enters the dispatch-eligible pool while an open break session lingers.
`rider-hrm.service.ts:442,499,528` and `383-388` (setPause vs checkOut lost update + orphan open break).

### N4 — Manual assign has no idempotency 🔶 Low
Auto-dispatch dedups on `assignmentRequestId` (`UQ_rider_assignment_request_id`); manual assign supplies
none → double-click yields duplicate ledger rows + duplicate/incorrect rider push notifications.
`orders.service.ts:2966,3123`.

## O. Rider payroll & comp plans

### O1 — Double payroll run → double pay **Critical** 🔶
`runPayroll` never checks for an existing run over the same `(tenant,branch,period)`; the scope index is
non-unique and `UQ_rider_payroll_run_rider` is `(run_id, rider_user_id)` so it never collides across two
run ids. A slow run + a retry/double-click creates two finalized runs → every rider paid twice.
`rider-hrm.service.ts:827,850,1054`.

### O2 — `reversePayrollRun` double-reverse 🔶 High
Status check is `findOne`-then-later-save with no txn/lock. Double-click → two `-total` reversal items per
line; the run nets to `-total` (rider appears to owe a full period). Non-atomic across lines too.
`rider-hrm.service.ts:1125-1141`.

### O3 — `runPayroll` not transactional → torn draft run 🔶 Med
Run row + per-rider lines + finalize are separate autocommits; a mid-loop throw leaves a committed
`draft` run with partial lines that can't be reversed, and readers see partial totals. `rider-hrm.service.ts:850-1054`.

### O4 — Two active comp-plans in one scope 🔶 High
`activateCompPlan` does a non-atomic deactivate-then-activate with no txn/lock and no partial-unique index
for "one active per scope". Two concurrent activations both end `active` → `getActiveCompPlan` picks an
unintended plan → systematic mispay. `rider-hrm.service.ts:744-767`.

### O5 — Comp-plan version collision 🔶 Med
`version` derived from a racy `findOne(order by version DESC)+1` with no unique constraint → two plans
share a version → nondeterministic active-plan tiebreak. `rider-hrm.service.ts:668-677`.

## P. Menu / branch-menu admin

### P1 — Concurrent `branch_menu_item` edits → 86 silently un-done 🔶 Med
Kitchen sets `is_available=false` while a manager edits `price_override`; both load the same snapshot and
full-entity `save()`; the price save writes `is_available=TRUE` back → the item is un-86'd.
`branch-menu-items.service.ts:311-336`.

### P2 — `linkBrandMenuItem`/`sync` concurrent link → 500 🔶 Low
`findOne`-then-save vs `UQ_branch_menu_items_branch_item`; the loser 500s (and can abort a non-transactional
`sync` mid-way). `branch-menu-items.service.ts:200-216`.

### P3 — `sync()` rebuilds a branch menu non-transactionally 🔶 Med
Read → `remove(toRemove)` → loop re-add, all separate txns. A customer/POS hitting `getBranchMenu`
mid-sync sees a partial menu; two concurrent syncs produce a non-deterministic final set.
`branch-menu-items.service.ts:235-287`.

### P4 — Deleting a menu item CASCADE-wipes order history + races createOrder 🔶 High
`order_items.menu_item` / `order_item_addons.addon` are `ManyToOne onDelete:'CASCADE'`. `deleteItem`/
`deleteAddon` don't check for referencing orders → deleting a still-sold item **cascade-deletes all past
order lines** (revenue history loss). Interleaved with the non-transactional `createOrder`, a delete can
FK-fail the in-flight line (partial order) or cascade-wipe a just-created line. `menu.service.ts:569,1092`,
`order-item.entity.ts:70`, `order-item-addon.entity.ts:41`.

## Q. Auth / OTP / customer

### Q1 — OTP verify is check-then-act, not atomic single-use 🔶 High
`findValid` then `save(used_at)`, no `FOR UPDATE`, no atomic `UPDATE … WHERE used_at IS NULL RETURNING`,
no unique on `(code,purpose,used_at)`. For `password_reset`, victim + attacker both POST verify with the
same code at once; both pass the `used_at IS NULL` read, both `setPassword` → single-use broken,
**reset-race account takeover** (attacker's password can win). `otp.service.ts:90,137,154`,
`consumer.controller.ts:721`.

### Q2 — OTP resend cooldown bypass 🔶 Med
`findOne(latest)`-then-insert cooldown; concurrent send-otp calls both pass → N SMS (SNS cost + spam) and
multiple live codes, widening the brute-force surface. `otp.service.ts:109`.

### Q3 — No atomic OTP attempt limiter → brute force 🔶 Med
No failed-attempt counter, no invalidate-after-N, no ThrottlerGuard. Thousands of concurrent verify guesses
against a live 6-digit code (15-min TTL) are uncapped and cost nothing on a miss → realistically crackable.
`otp.service.ts:137`, `consumer.controller.ts:571,671`.

### Q4 — `findOrCreateTenantCustomerForPhone` unique-violation → 500 🔶/⚠️ Med
Two orders for a brand-new phone complete at once; both `findOne`→null→`save`. `UQ_customers_tenant_phone`
stops the duplicate row but the save is uncaught → the loser's completion **and its loyalty earn** 500.
The guarded signup path (`isUniqueViolation()` at `customers.service.ts:410`) shows the intended pattern.
`customers.service.ts:750,772,797`, `loyalty.service.ts:176`.

### Q5 — Admin `create()` no unique catch / wrong conflict message 🔶 Low
Admin create 500s on the `(tenant,phone)` race; `createForConsumer` maps an *email* collision to a
misleading "phone already exists". `customers.service.ts:293,399-422`.

### Q6 — Consumer→tenant merge unlocked reads 🔶 Low
`mergeConsumerIntoTenantCustomer` runs in a txn but reads both rows without `FOR UPDATE`; concurrent
merges combine a stale `loyaltyPointsBalance` (lost update) and the second `remove(consumer)` errors.
Damage limited because `loyaltyPointsBalance` is now deprecated/zeroed. `customers.service.ts:612,695,797`.

## R. Notifications / ratings

- **R1** 🔶 `notifications.act()` — both cashiers accept a shared alert; both pass the non-locking
  `status==='resolved'` early-return → `resolved_by` reflects only the later writer, duplicate
  `notification:resolved` emitted. `notifications.service.ts:333`.
- **R2** 🔶 `syncSystemAlerts` overlapping cron ticks double-resolve the same cleared alert (open side is
  guarded by `UQ_notifications_dedupe_open`; resolve side isn't). `notifications.service.ts:173,399`.
- **R3** 🔶 First-time rating double-submit 500s on the unique index instead of upserting idempotently
  (data integrity fine). `ratings.service.ts:218,268`.

---

## What was NOT covered (gaps for the re-run)
- **Loyalty redemption** (I2) — the loyalty hunter failed its schema retries; only *earn* was audited.
- **Cross-module systemic pass** — the 3 systemic lenses (single-request multi-resource transaction
  boundaries; ABBA deadlock / lock-ordering across the 5 lock sites; system-wide at-least-once /
  webhook / socket idempotency) were queued but killed by the session limit. These are where the
  *interactions* between the single-module races above compound.
- **~50 findings marked 🔶** — hunter-identified but not independently verified.

## Suggested fix primitives (recurring across findings)
- Serialize a business op on its owning row with `SELECT … FOR UPDATE` **inside** a transaction, and
  **re-check the invariant under the lock** (fixes the pattern-#4 "idempotency outside the lock" cluster).
- Replace counter RMW with a single atomic `UPDATE … SET x = x + :n WHERE …` (shift cash, versions).
- Gate read-model upserts on the ledger `INSERT … ON CONFLICT DO NOTHING RETURNING id` actually
  inserting (fixes the pattern-#5 inventory double-apply cluster).
- Add the missing DB uniqueness: `UNIQUE(order_id) WHERE type='earn'` on loyalty; one-active-order
  partial index per rider; one-non-terminal transfer-order per request; one active comp-plan per scope;
  one payroll run per period; coupon usage counter/limit.
- Accept a client `idempotency_key` on `createOrder`, `processPayment`, cart add, manual rider assign,
  payroll run, claim promotion — mirror the kiosk pattern.
- Replace `findOne`-then-`save(fullEntity)` with column-scoped `UPDATE`s or add `@VersionColumn` to
  `Order`, `Shift`, `InventoryTransferOrder`, `CartItem`, `RiderPresence`, `CustomerPromotion`.
- Catch `23505` → translate to `409`/idempotent re-fetch for the ⚠️ "correct-but-500" cluster.
