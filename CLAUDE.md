# CLAUDE.md

Multi-tenant, multi-brand, multi-branch restaurant POS + online ordering platform ("Foodies").

## Apps

| Folder | Stack | Port | Purpose |
|---|---|---|---|
| `backend/` | NestJS 11, TypeORM 0.3, PostgreSQL | 3001 | API for all clients. Prefix `/api`, Swagger at `/api-docs` |
| `frontend/` | React 18 + Vite, TS strict | 3000 | Admin panel, POS, Kitchen (KDS), FOH, Rider app. Proxies `/api` → 3001 |
| `consumer-web/` | Next.js 16, React 19 | 3002 | Public customer site (discovery + menu browsing; checkout happens in mobile app / web flow) |
| `app-subdomain/` | Static HTML | — | Flutter app deep-link assets (`assetlinks.json`) |

## Commands

Root (monorepo, uses `concurrently`):
- `npm run dev` — backend + frontend · `npm run dev:all` — all three · `npm run build`
- `npm run install:all` — installs everywhere (backend needs `--legacy-peer-deps`)

Backend (`cd backend`):
- `npm run start:dev` · `npm run build` · `npm test` (Jest, `*.spec.ts`) · `npm run test:e2e` · `npm run lint`
- Migrations: `npm run migration:run | migration:revert | migration:show` (builds first, runs against `dist/data-source.js`). `synchronize: false` — schema changes always go through a timestamped migration in `backend/src/migrations/`. Migrations also run automatically on app boot.
  - Naming: `<13-digit-timestamp>-<PascalCaseName>.ts`, and the exported class must end with the same timestamp. **Timestamps must be unique** — take the next free number in the `1760000000NNN` sequence. Ties make execution order depend on filesystem glob order, so dev and prod can apply the same pair in opposite orders. `migration-naming.spec.ts` enforces this. Two legacy pairs (`…091`, `…092`) are grandfathered and must **not** be renamed: the `migrations` table matches on name, so renaming an applied migration makes it re-run in production.
- Seeds: `npm run seed` (demo owner `owner@demo.com` / `owner123`), `seed:menu`, `seed:inventory`, `seed:uoms`, per-brand seeds (`seed:wok-and-go`, `seed:peri-peri-co`, `seed:fireaway`, `seed:pizza-pasta`)

Frontend: `npm run dev`, tests via Vitest (`globals: true`, jsdom). Husky pre-commit runs lint-staged.

## Architecture: the scoping model (read this first)

Hierarchy: **Tenant → { Brand, Branch }**. Brand and Branch are siblings under Tenant, linked many-to-many via `branch_brands`. Mental model: **Brand = what you sell, Branch = where/how you sell it, Tenant = the business umbrella.**

```
Tenant (tenant_id; super admin requests have tenantId = null)
├─ BRAND-scoped (menu content):
│    menu_categories, menu_items (→ menu_variants), menu_addons,
│    modifier_groups (→ modifiers), deal_components, brand_order_ratings
├─ BRANCH-scoped (operations):
│    branch_menu_items (per-branch price/availability overrides),
│    kitchen_stations, printer_routes, carts
├─ BRANCH + BRAND: shifts (one open shift per brand per branch;
│    opened by brand-locked staff; closing is opener-only; `shifts:override`
│    holders — owner/GM/managers — open for any brand and close others' shifts.
│    Till maths: expected = opening + cash tendered − cash-outs; actual =
│    drawer count. `shift_cash_outs` logs mid-shift hand-overs to the owner
│    (append-only, voided not deleted, open shifts only, `shifts:cash-out`);
│    rider cash is NOT part of shift reconciliation)
├─ TENANT + BRANCH (operations with tenant column):
│    orders, kiosk_orders — every order is SINGLE-BRAND (brand_id set);
│       POS/kiosk/consumer-app reject mixed carts; consumer-web mixed
│       carts auto-split into one order per brand (shared order_group_id)
│    all inventory/procurement (on-hand, batches, GRNs, POs,
│       stocktakes, transfers, wastage) — item MASTER is tenant-level
├─ TENANT-scoped: discounts (with eligibility_brand_ids /
│    eligibility_branch_ids arrays), customers, recipes, uoms,
│    vendors, rider_profiles, tenant_users, roles
└─ GLOBAL: users, permissions, otp_codes
```

User assignment: `users` is global; `tenant_users` ties a user to a tenant; `branch_users` (branchId + userId + roleId + **nullable brandId**) ties them to branches. A non-null `brand_id` on every `branch_users` row = **brand-locked user**.

### Auth & enforcement

- JWT payload is only `{ sub, email }`. `RoleAccessGuard` (`backend/src/auth/role-access.guard.ts`) enriches `request.user` per request with:
  - `tenantId` (null ⇒ super admin, no scoping)
  - `allowedBranchIds` — null = all branches (user has `all-branches:access` permission, e.g. GM/owner); else the branch IDs from `branch_users`
  - `allowedBrandIds` — null = unrestricted; an array only when the user is brand-locked (every `branch_users` row has `brand_id`; GM/owner never locked)
- Brand lock is enforced server-side in: kitchen/KDS, admin orders, POS quote/order, reports/dashboard, discounts, customers (via brand order history), users/branch-users, menu admin CRUD (items/categories/variants/addons/modifiers/deals), branch-menu-items, shifts, and the admin brands list. The "Brand Admin" role (slug `brand_admin`) bundles the brand-scoped permissions; demo accounts: `peperi@demo.com`, `wokandgo@demo.com`, `fireaway@demo.com` (password `brand123`, seeded by `npm run seed:brand-admins`).
- Reports/dashboard (`backend/src/reports/`) scope by `tenantId + allowedBranchIds + allowedBrandIds + optional branch_id/brand_id` via `applyOrderScope()`/`applyBrandScope()`; `dashboard-summary` returns a `sales_by_brand` breakdown for the owner.
- Delivery fee is configured per **brand** (`brands.delivery_flat_fee`); each split web order charges its own brand's fee. A rider carries exactly one active order at a time (auto-dispatch and manual assignment both enforce it).
- Guards/decorators: `JwtAuthGuard`, `RoleAccessGuard`, `CustomerJwtAuthGuard` (consumer), `@CurrentUser()`, `@RequirePermission()`.
- Kiosk pay-at-counter endpoints authenticate with the `KIOSK_API_KEY` shared secret, not JWT.

## Conventions

- DB naming is snake_case (`typeorm-naming-strategies`); entity properties are camelCase. ~86 entities in `backend/src/entities/`, one feature module per domain in `backend/src/<module>/`.
- DTO validation via class-validator; global `ValidationPipe({ whitelist: true, transform: true })` — undeclared body fields are stripped.
- Frontend: API calls live in `frontend/src/services/api/` (e.g. `adminService.ts`); server state via React Query, client state via Zustand; Tailwind for styling; shared types in `frontend/src/types/index.ts`. Pages grouped by surface: `src/pages/{Admin,POS,Kitchen,FOH,Rider}/`.
- Consumer-web: App Router under `consumer-web/src/app/`; API client/stores in `src/lib/`.
- Real-time (KDS, rider tracking) via socket.io; CORS for both HTTP and WS driven by `CORS_ORIGINS` env (empty = reflect request).

## Environment

`backend/.env.example` is the reference. Required: `DB_HOST/PORT/DATABASE/USERNAME/PASSWORD` (default DB `foodies` on localhost), strong `JWT_SECRET` (32+ chars, app rejects weak values), `KIOSK_API_KEY`. Media uploads need S3 (`MEDIA_STORAGE_DRIVER=s3`, `AWS_*`, CloudFront URL); push notifications need Firebase service-account vars.

Frontend: `VITE_API_URL`, plus `VITE_GOOGLE_MAPS_API_KEY` for the POS delivery address lookup (empty ⇒ plain address box, no coordinates — `docs/POS_GOOGLE_PLACES.md`).

Production: PM2 + Nginx on EC2, no Docker — `docs/EC2_DEPLOYMENT_RUNBOOK.md`. Frontend build served from `/var/www/foodies`; Nginx proxies `/api` to 3001.

## Key docs

- `docs/MULTI_BRAND_SEPARATION_GUIDE.md` — brand-lock design (branch_users.brand_id)
- `docs/MULTI_BRAND_ORDER_FLOW.md` — mixed-brand order splitting
- `docs/DATABASE_OVERVIEW.md` + `docs/DATABASE_ERD.md` — schema reference
- `docs/DISCOUNTS.md` — discount eligibility rules
- `docs/SYSTEM_FUNCTIONALITIES_AND_FLOW.md` — roles & order lifecycle
- `docs/POS_GOOGLE_PLACES.md` — POS address autocomplete & delivery coordinates
