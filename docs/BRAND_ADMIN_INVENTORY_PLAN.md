# Brand Admin — Cross-Branch Inventory Visibility & Stock Requests

**Status:** Implemented on branch `asad` · **Date:** 2026-06-24

> **As built.** Approval model = *source branch approves* (two-party); requests are *blind*.
> Brand admins were granted `inventory:view:brand`, `inventory:transfer:request`, and
> `inventory:transfer:approve` (the last auto-scoped by bucket authority to their own brand
> as source). One deviation from the plan below: the item-master + UOM reference lists used
> to build a request are served by read-only endpoints under the transfers prefix
> (`/admin/inventory/transfers/reference/{items,uoms}`), because `/admin/inventory/items|uoms`
> also host writes and couldn't be loosened. Backend: 97 tests pass; frontend builds clean.
> Not yet done: pre-filling the request form's destination to the admin's brand, and multi-line
> requests (the form still submits one line; backend already accepts a `lines[]` array).

Lets a **brand admin** (brand-locked to one brand, assigned across multiple branches)
(1) **see their brand's stock across all their branches** in one view, and
(2) **request stock from a branch's pool or from another brand**, with the **source side approving** before anything moves.

Related: `MULTI_BRAND_SEPARATION_GUIDE.md` (brand lock via `branch_users.brand_id`), brand-bucket inventory model (`inventory_on_hand.brand_id`: `null` = branch shared pool).

---

## Decisions (locked)

1. **Source approver = anyone with source-bucket authority** — holds `inventory:transfer:approve` **and** the branch/brand scope covering the source bucket. In practice a branch manager/owner approves pulls from the **branch pool**; a brand's own admin approves pulls from **their brand's** bucket.
2. **Blind requests** — the requester does not see source stock. The source approver sees the request and approves (has stock) or rejects with a reason (e.g. out of stock).

---

## Current state (verified against code)

- **Brand admins have zero inventory access today.** The `brand_admin` role bundles no `inventory:*` permission (`backend/src/seed-brand-admins.ts:42-65`), and every inventory + transfer route sits behind a single coarse rule `{ prefix: '/admin/inventory', any-of [inventory:view|receive|adjust|waste|stocktake|transfer] }` (`backend/src/auth/path-permissions.ts:141-151`). `RoleAccessGuard` 403s before any service logic (`backend/src/auth/role-access.guard.ts:95-102`). Frontend nav-hides + redirects them.
- **Auth enrichment is correct for our needs.** A brand admin across N branches gets `allowedBranchIds = [those N branches]` and `allowedBrandIds = [their brand]` (`role-access.guard.ts:134-182`); they are never `all-branches`.
- **On-hand read already brand-filters** via `oh.brandId IN (:...allowedBrandIds)` (`backend/src/inventory/inventory.service.ts:593-597`) but is **pinned to one branch** (`GET branches/:branchId/on-hand`). No aggregated "my brand across branches" view exists.
- **Ledger read does NOT brand-filter** (`inventory.service.ts:609-673`) — would leak other brands' movements.
- **Branch scope is not enforced anywhere in inventory** — `resolveTenantId` returns the tenant for any branchId without checking `allowedBranchIds` (`inventory.service.ts:64-79`); the inventory module never reads `allowedBranchIds`.
- **Transfer model already supports the directions we need** (`backend/src/inventory/inventory-transfer.service.ts:76-97`): `source_brand_id`/`destination_brand_id` are nullable (`null` = branch pool). But:
  - It's a **single self-driven document** — `approveRequest`/`dispatchOrder`/`receiveOrder` check only tenant match + status (`inventory-transfer.service.ts:141-155`); a requester can self-approve and dispatch.
  - `createRequest` brand-lock forbids naming **another brand** as source, so brand→brand requests are currently impossible.
  - `listRequests`/`listOrders` filter by tenant only — a brand admin would see every transfer in the tenant.

---

## Authority model (the core)

A single predicate drives every scope check. In `inventory-transfer.service.ts`:

```ts
// Can this user act on the (branch, brand) bucket?
function canActOnBucket(user, branchId, brandId): boolean {
  const branchOk = user.allowedBranchIds == null
                || user.allowedBranchIds.includes(branchId);
  const brandOk = brandId == null
    ? user.allowedBrandIds == null          // pool: only whole-branch authority (not brand-locked)
    : (user.allowedBrandIds == null || user.allowedBrandIds.includes(brandId));
  return branchOk && brandOk;
}
```

Action gates (permission **and** bucket authority):

| Action | Side | Permission | Bucket authority |
|---|---|---|---|
| create request | destination | `inventory:transfer:request` | `canActOnBucket(dest_branch, dest_brand)` |
| approve / reject | source | `inventory:transfer:approve` | `canActOnBucket(src_branch, src_brand)` |
| dispatch | source | `inventory:transfer:approve` | `canActOnBucket(src_branch, src_brand)` |
| receive | destination | `inventory:transfer:request` | `canActOnBucket(dest_branch, dest_brand)` |

Consequences that fall out for free:
- A brand admin (locked to Brand X) **can** create a request whose destination is Brand X at one of their branches, sourced **blind** from any branch pool or any other brand.
- They **cannot self-approve** an outgoing request: approving needs source authority, and they have none over a pool (`allowedBrandIds != null`) or over another brand.
- They **can approve/dispatch** an *incoming* request that pulls from **their own** brand bucket — exactly right.
- `inventory:transfer` (legacy) continues to satisfy both permission slots for owner/GM.

---

## Backend changes

### 1. Permissions
Add to `backend/src/roles/permissions.dto.ts` (after line 55):
- `INVENTORY_VIEW_BRAND: 'inventory:view:brand'`
- `INVENTORY_TRANSFER_REQUEST: 'inventory:transfer:request'`
- `INVENTORY_TRANSFER_APPROVE: 'inventory:transfer:approve'`

**Migration** (new timestamped file in `backend/src/migrations/`, mirror `1740000000043-InventoryProcurementRecipePermissions.ts:108-122`):
- Insert the three permissions.
- Assign: `brand_admin` → `inventory:view:brand`, `inventory:transfer:request`, `inventory:transfer:approve` (the approve is auto-scoped by bucket authority to their own brand as source). `owner`/`super_admin` and branch-manager roles → all three (plus they keep `inventory:transfer`).

**Seed:** add `inventory:view:brand`, `inventory:transfer:request`, `inventory:transfer:approve` to `BRAND_ADMIN_PERMISSIONS` in `backend/src/seed-brand-admins.ts:42-65`.

### 2. Path-permission rules
Add **longer-prefix** entries (longest-match wins, `role-access.guard.ts:78-83`) above the `/admin/inventory` rule in `backend/src/auth/path-permissions.ts`:
- `/admin/inventory/brands` → `[INVENTORY_VIEW_BRAND, INVENTORY_VIEW]`
- `/admin/inventory/transfers` → `[INVENTORY_TRANSFER_REQUEST, INVENTORY_TRANSFER_APPROVE, INVENTORY_TRANSFER]`

Mirror both in the frontend `frontend/src/lib/pathPermissions.ts` so nav-hiding/redirects align.

### 3. Expose the permission set to services (small guard change)
The path gate is coarse (any-of reaches the controller), so the **service** must enforce the action-specific permission. In `RoleAccessGuard.canActivate` (`role-access.guard.ts`), after computing `getUserPermissionNames`, attach it: `user.permissions = [...permissionNames]`. Thread `permissions?: string[]` onto the transfer service's `TenantContextUser` so `createRequest`/`approve`/`dispatch`/`receive` can check the specific key. (`getUserPermissionNames` is already computed in the guard — this just stops throwing it away.)

### 4. Cross-branch brand on-hand (new read)
- **Service** `getBrandOnHand({ tenantId, brandId, allowedBranchIds })` in `inventory.service.ts`:
  - branches = `branch_brands` for `brandId`, **intersected with `allowedBranchIds`** (if not null).
  - query `inventory_on_hand WHERE tenant_id, branch_id IN (...), brand_id = :brandId`.
  - return per item: `{ inventory_item_id, total_qty, by_branch: [{ branch_id, qty }] }`.
  - Brand bucket only — pool is intentionally excluded (consistent with brand-lock; supports the "blind" decision).
- **Controller** `GET /admin/inventory/brands/:brandId/on-hand` in `inventory.admin.controller.ts`: assert `brandId ∈ user.allowedBrandIds` (else 403), pass `user.allowedBranchIds`. This is the safe, brand-locked replacement for the unguarded `getBrandLedgerSummary` (`inventory.service.ts:675-724`) for the "see my stock" use case.

### 5. Transfer flow — scope + two-party approval
In `backend/src/inventory/inventory-transfer.service.ts`:
- Add `allowedBranchIds` + `permissions` to `TenantContextUser` (lines 18-24); add the `canActOnBucket` helper above.
- **`createRequest`** (line 58): require `inventory:transfer:request`; require `canActOnBucket(destination)`. **Relax the source brand-lock** — allow `source_brand_id` to be the pool or *any* brand (this is what enables brand→brand and branch-pool requests), because the source approves. Keep the "(branch, brand) tuples must differ" guard (lines 78-85).
- **`approveRequest` / `rejectRequest`** (line 136): require `inventory:transfer:approve` + `canActOnBucket(source)`. This *is* the source-side approval gate and structurally blocks self-approval.
- **`dispatchOrder`** (line 209): require `inventory:transfer:approve` + `canActOnBucket(source)`. **`receiveOrder`** (line 472): require `inventory:transfer:request` + `canActOnBucket(destination)`.
- **List scoping** — replace tenant-only `listRequests`/`listOrders` (lines 43-56) with two scoped views:
  - **My requests** (destination): rows where `canActOnBucket(destination)` for the caller.
  - **Incoming to approve** (source): rows where `canActOnBucket(source)` for the caller. Owner/GM (`allowedBranchIds == null`) see all.
  - Implement as SQL predicates on branch/brand, not post-filter, to keep paging correct.

The status machine is unchanged (`submitted → approved/order → dispatched_partial → received_partial/closed`); "submitted" now means "awaiting source approval," which the existing approve step already models. No new columns required on `inventory_transfer_requests`/`_orders`.

### 6. Optional hardening (recommended)
- Brand-filter `listLedger` (line 609) when `allowedBrandIds` is set; lock `getBrandLedgerSummary` to `brandId ∈ allowedBrandIds`.
- Pre-existing cross-branch leak: `resolveTenantId` ignores `allowedBranchIds` (lines 64-79). Brand admins won't hit it (no per-branch `inventory:view`), but add a branch-scope assertion before granting broader inventory perms to anyone.

---

## Frontend changes

- **"My Brand Stock" page** (gated by `inventory:view:brand`): items × branches matrix for the brand, from `GET /admin/inventory/brands/:brandId/on-hand`. Add `getBrandOnHand` to `frontend/src/services/api/inventoryService.ts` (a `getOnHand` brand param and `getBrandLedgerSummary` already exist but are unused).
- **Transfer requests** (rework `frontend/src/pages/Admin/Inventory/StockTransfers.tsx`):
  - *New request* form **pre-scoped**: destination brand = the admin's brand (locked); destination branch = picker over their branches; source branch = any branch; source bucket = pool (default) or a brand; **multi-line items** (backend DTO already accepts a `lines` array). No source-stock display (blind).
  - *My requests* list (destination view) with status + rejection reasons.
- **Incoming approvals** view for source-bucket holders (branch managers/owners, and brand admins for their own brand as source): list of requests where they hold source authority, with approve / reject (reason) / dispatch.
- **Nav**: surface the two pages under the new permission gates in `frontend/src/App.tsx`; the existing nav-filter + redirect (`App.tsx:416-436`) will then admit brand admins.

---

## Tests

- Extend `backend/src/inventory/inventory-transfer.service.spec.ts`:
  - brand admin **can** create a request sourced from another brand / a branch pool;
  - brand admin **cannot** approve their own outgoing request (no source authority);
  - a source-bucket holder **can** approve + dispatch; a user without `inventory:transfer:approve` **cannot**;
  - destination authority enforced on create + receive;
  - list scoping returns only in-scope requests/orders.
- New spec for `getBrandOnHand`: branch intersection with `allowedBranchIds`, and brand-lock rejection when `brandId ∉ allowedBrandIds`.

---

## Sequencing

1. Permissions + migration + seed + path rules + guard `user.permissions` (unblocks brand-admin access).
2. `getBrandOnHand` endpoint + "My Brand Stock" page (delivers visibility — the simpler half).
3. Transfer scope + two-party approval + list scoping + backend tests.
4. Frontend request + incoming-approval UIs.
5. Optional ledger/summary hardening.

## Notes / risks

- The `inventory:transfer:approve` grant on `brand_admin` is safe only because `canActOnBucket` restricts approval to buckets the user actually controls — verify that predicate is applied on **every** source-side action (approve, reject, dispatch).
- "Blind" means a requester can target a source branch with no stock; rejection-with-reason is the feedback path. If this proves clumsy in practice, a follow-up could add an opt-in source-pool availability read for the requester.
- No schema changes to transfer tables; this is permissions + scope-enforcement + one new read endpoint + frontend.
