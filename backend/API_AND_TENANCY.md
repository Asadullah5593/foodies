# API docs (Swagger) and multi-tenancy

## User tables: `users`, `tenant_users`, `branch_users`

| Table | Role | What it controls |
|-------|------|------------------|
| **users** | **Identity** | Who can log in. Stores email, password, name, status. No tenant or branch here—only login identity. |
| **tenant_users** | **Tenant membership** | Which tenant(s) the user belongs to and their **tenant-level role** (e.g. `owner`, `manager`). Drives **what data they see**: JWT `tenant_id` comes from here. One row per user → tenant link. **No row** = super admin (sees all tenants). **Has row** = tenant user (sees only that tenant’s brands, branches, menu). |
| **branch_users** | **Branch assignment** | Which **branches** the user can work at, with a **branch-level role** (e.g. `cashier`, `kitchen`). Used for POS, KDS, shifts—“which branches can I open a shift / run register / work kitchen?” Does **not** change what brands/branches they see in Admin (that’s `tenant_users`); it defines assignment for branch-level operations. |

**In short:**  
- **users** = can log in.  
- **tenant_users** = which tenant they belong to → **what they see** (one tenant vs super admin).  
- **branch_users** = which branches they’re assigned to → **where they can work** (POS/KDS/shifts).

After seed, you can log in as different accounts to see the effect (see seed output or “Seeded login accounts” below).

---

## Swagger (OpenAPI)

- **URL**: With the API running, open: **`http://localhost:3001/api-docs`**  
  (Use your actual host/port if different; the app uses `process.env.PORT ?? 3001`.)
- All API routes are under the **`/api`** prefix (e.g. `POST /api/admin/tenants`).
- In Swagger UI you can “Authorize” with a **Bearer token** (JWT from `POST /api/auth/login`).

---

## Multi-tenancy (tenant → brand → branch)

**Intended design (see [MENU_OWNERSHIP.md](./MENU_OWNERSHIP.md)):** Menu items, variants, and addons should be owned by **brand** (what the item is); **branch** defines how it’s sold (price overrides, availability). **Tenant** is the top-level container for ownership and data separation.

**Current implementation:** Products and categories are **tenant-based**; brands inherit from the tenant. The codebase may be refactored to the brand-owned model described in MENU_OWNERSHIP.md.

| Level    | Meaning (current) |
|----------|-------------------|
| **Tenant** | Company. Top-level. Owns **categories**, **products** (menu items), and **addons**. |
| **Brand**  | Belongs to one tenant. **Inherits** the tenant’s categories and products. Can have multiple **branches**; a **branch** can have multiple **brands** (many-to-many, e.g. food court). |
| **Branch** | Can be linked to **one or more brands**. **Branch + brand(s) = location.** Physical outlet. |

- Each **tenant** has its own **categories**, **products**, and **addons**. Each tenant can have multiple **brands**; each branch can be associated with multiple brands (many-to-many).
- When a branch serves menu (POS or consumer), the menu is the **tenant’s** categories/products (via branch’s brands → tenant).
- **Menu API**: Categories, items, and addons are scoped by the **current user’s tenant** (from JWT). Create category/item/addon uses tenant from auth; list uses tenant from auth. Addons can be filtered by `category_id` (optional).

**Confirmation (tenant menu, brands, branches, shifts):**

| Question | Answer |
|----------|--------|
| **Tenant-based categories and menus?** | **Yes (current).** `menu_categories`, `menu_items`, and `menu_addons` are **tenant-scoped** (`tenant_id`). Target design is **brand-scoped** (see MENU_OWNERSHIP.md). |
| **Brands inherit tenant menu?** | **Yes.** Brands do **not** have their own menu in the current implementation. A brand belongs to a tenant; when a branch (under that brand) serves menu, the menu is the **tenant’s** categories/products. |
| **Showing brand-wise menus?** | **No.** We show the **tenant’s menu** when serving at a **branch**: POS/KDS/consumer use branch_id; the backend resolves branch → brand(s) → tenant and returns the tenant’s menu (with branch-level overrides from `branch_menu_items`: price override, per-item enable/disable). |
| **Branch-wise shifts?** | **Yes.** Shifts are **branch-level** (`shifts.branch_id`). Each shift is opened/closed at a specific branch; reports and KDS use branch context. |
| **Branch-level menu enable/disable?** | **Yes.** Each branch has a **menu_enabled** flag (default `true`). When `menu_enabled` is `false`, POS/KDS/consumer menu for that branch returns an empty list. Per-item enable/disable remains in `branch_menu_items.is_available`. |

---

## Roles and permissions

- **Permissions** are system-defined and seeded (e.g. `orders:create`, `discounts:apply`, `reports:view`).  
  List: **`GET /api/admin/roles/permissions`** (requires JWT).
- **Roles** can be **system** (`tenant_id` null) or **tenant-specific**.  
  List: **`GET /api/admin/roles`** (returns roles for the current tenant + system roles).
- **Create/update/delete roles** and **assign permissions** to a role: use the Admin Roles API (see Swagger under “Admin – Roles & Permissions”) or the Admin UI “Roles” page.

Seeded roles: **Owner**, **Manager**, **Cashier**, **Kitchen**.  
User ↔ tenant: `tenant_users` ( **role_id** → `roles.id`, e.g. Owner, Manager, Cashier).  
User ↔ branch: `branch_users` ( **role_id** → `roles.id`, e.g. Cashier, Kitchen).  
Assigning branch users (who can work at which branch) requires **branches:manage** (Manager or Owner only).

---

## Super admin vs tenant users

- **Tenant user**: Has a row in `tenant_users` (linked to one tenant). JWT includes `tenant_id`.  
  - Sees only **that tenant’s** brands and branches.  
  - Can create/edit/delete brands for their tenant; can create/edit/delete branches only under their tenant’s brands.  
  - Tenants list returns only their own tenant.  
- **Super admin**: Has **no** row in `tenant_users`. JWT has `tenant_id: null` and login response includes `is_super_admin: true`.  
  - Sees **all** tenants, all brands (with `tenant_name` in response), and all branches (with `tenant_name` and `brand_name`).  
  - Cannot create brands (tenant users create brands for their tenant). Can create/edit/delete branches under any brand.  
  - Can create/edit/delete tenants.  
- **Brands dropdown** (e.g. Create Branch): For tenant users it lists only their tenant’s brands. For super admin it lists all brands with tenant label (e.g. “Brand Name (Tenant Name)”).

---

## `branch_users` table

**Purpose:** Links users to **branches** with a **role** (e.g. `cashier`, `kitchen`). It answers: “Which branches can this user work at?”

- Used for **branch-level access**: POS, KDS, shifts. A user may be assigned to specific branches via this table.  
- A tenant user (e.g. owner) can be linked to many branches of their tenant via `branch_users` so they can open shifts, run POS, or manage kitchen at those branches.  
- Managed via Admin → Branch Users (assign/remove users to a branch). Only users with **branches:manage** (Manager or Owner) can assign or remove branch users. When assigning, you choose a **role** (e.g. Cashier) for that branch; the role is stored as **role_id** in `branch_users`.

**Role-based access (tenant-level role from tenant_users):**
- **Cashier**: POS only (orders:create, orders:view, discounts:apply).
- **Manager**: Add branches, access POS (branches:manage + cashier permissions).
- **Owner**: Full access (all permissions).
- **Super Admin** (role): All permissions; this role is **view-only** in the Roles UI (name and permissions cannot be edited).

---

## Seeded login accounts (after `npm run db:reset`)

| Email | Password | users | tenant_users | branch_users | Frontend effect |
|-------|----------|-------|-------------|-------------|-----------------|
| superadmin@demo.com | owner123 | ✓ | **none** | none | **Super admin**: sees all tenants, all brands (with tenant label), all branches (tenant → brand). Can create tenants; cannot create brands. |
| acme_owner@demo.com | owner123 | ✓ | Acme Corp (owner) | Downtown (cashier) | **Tenant user**: sees only Acme Corp’s brands/branches/menu. Create Branch dropdown shows only Acme’s brands. |
| beta_owner@demo.com | owner123 | ✓ | Beta Foods (owner) | Main, West (cashier) | **Tenant user**: sees only Beta Foods’ brands/branches/menu. Create Branch dropdown shows only Beta’s brands. |
| acme_cashier@demo.com | owner123 | ✓ | Acme Corp (cashier) | Downtown only (cashier) | **Tenant user**: same data scope as Acme (Acme’s brands/branches). Assigned to one branch only (Branch Users page shows single branch). |
