# Rough Foodie (Foodies) — System Functionalities + Client Flow

This document is a **client-facing** overview of what the system provides, organized by **modules** and explained through the **simplest end-to-end flows** from **login → setup → menu → orders → payments → delivery → logout**.

## Core concepts (simple)

- **Tenant (Business)**: a restaurant group / company account.
- **Brand**: a restaurant brand under the tenant.
- **Branch**: a physical location/store. A branch can host **one or multiple brands** (e.g., a food court concept).
- **Admin panel**: setup and management (brands, branches, users, menu, discounts, reports).
- **POS**: order taking and payment collection at a branch (requires an **open shift**).
- **Kitchen / KDS**: kitchen screen to view orders and update preparation status.

## At-a-glance: what the system does

- **Secure login (JWT)** for staff users (Admin/POS/Kitchen).
- **Multi-tenant setup**: one system can host multiple restaurant businesses (tenants).
- **Operational hierarchy**: Tenant → Brands → Branches → Branch menu.
- **Menu management**: categories, items, variants, addons, modifier groups, modifiers, and deals.
- **Branch-level menu control**: enable/disable items, hide items online, override prices per branch.
- **Order management**:
  - POS order creation with live **quote** (totals + discounts + loyalty redemption).
  - Automatic **multi-brand split**: one “customer order” may be split into **multiple brand orders** under one `order_group_id`.
  - Invoices: **per-brand invoice** and **main customer invoice** (group invoice).
- **Payments**: record payments against orders (cash/card/etc., with optional reference number).
- **Shifts**: open/close cash shifts per branch (POS availability is linked to open shifts).
- **Discounts**: auto discounts and coupon-code discounts (see “Discounts” module below).
- **Customers & loyalty**: customer list + loyalty settings/balance/earn/redeem.
- **Kitchen (KDS)**: list orders, view order detail, update status, generate KOT payload.
- **Reports**: day overview, sales summary, top items, shift summary.
- **Optional consumer-facing APIs** (public): brands/branches browsing, customer register/login, cart, place order, pay, order history.
- **Logout**: stateless logout endpoints; the client discards tokens.

## End-to-end flow (simplest “happy path”)

### 1) Super Admin flow (platform-level)

Use when your organization manages many tenants (businesses) on the same platform.

- **Login** (staff login).
- **Create a Tenant (Business)**:
  - Tenant name/slug/status, tax defaults, loyalty enabled.
  - Create the **tenant owner user** (email + password).
- **(Optional) Manage global permissions** (platform-level permission catalog).
- **Logout**.

### 2) Tenant Admin / Owner flow (business setup)

This is the “client setup” flow you typically demo to a restaurant owner.

- **Login** (as tenant owner/admin).
- **Business Settings**:
  - Update business name/legal name, default tax rate, loyalty enabled.
  - Configure **loyalty settings** (spend-per-point, redemption rules, etc.).
- **Create Brand(s)**:
  - Brand name, logo, description, active/status.
- **Create Branch(es)**:
  - Select **one or more brands** that operate at the branch.
  - Configure branch capabilities: dine-in, takeaway, delivery, delivery fee, timezone, menu enabled.
  - (Optional) Immediately link menu items to this branch.
- **Create Users + Roles**:
  - Create staff users (POS, kitchen, managers).
  - Create tenant roles and assign permissions (what each role can do).
  - Assign users to branches (branch users) and give them branch roles.
- **Build the Menu** (per brand):
  - Categories → Items → (Variants/Addons/Modifiers/Deals).
  - Link addons and modifier groups to items.
- **Publish menu to branch**:
  - Sync which items are available at a branch.
  - Override branch prices and choose whether an item is hidden online.
- **Create Discounts (optional)**:
  - Auto-applied (no code) and/or promo-code discounts.
  - Scope discounts to specific brands/branches/categories/items as needed.
- **Logout**.

### 3) POS Operator flow (orders + payments)

POS is for day-to-day order taking at a branch.

- **Login**.
- **Open shift** (cash shift) for the branch (if not already open).
  - Only branches with an **open shift** are returned in the POS “branches list”.
- **Load POS menu for branch**:
  - System returns what order types the branch supports (dine-in / takeaway / delivery).
  - Shows the branch’s enabled items, with branch overrides.
- **Create order**:
  - Add items (with variants, addons, modifiers, notes).
  - Choose order type (dine-in/table, takeaway, delivery with address).
  - (Optional) enter discount code and/or redeem loyalty points.
  - Use **Quote** to confirm totals before placing.
- **Order is created**:
  - If cart contains multiple brands, the system creates **one order per brand** and ties them together with an `order_group_id`.
  - POS can view:
    - **Per-brand invoice** (each order)
    - **Main customer invoice** (group invoice)
- **Take payment(s)**:
  - Record payment method and amount (and optional reference).
  - Partial/multiple payments are supported at the “payments table” level (recorded as separate entries).
- **(Optional) Close shift** at end of day.
- **Logout**.

### 4) Kitchen / KDS flow (preparation)

- **Login**.
- **Select a branch** (must be a branch the user is allowed to access).
- **View incoming orders**:
  - Filter by station, status, category, brand, date range.
  - Optionally include completed orders.
- **Update order status** as kitchen progresses.
- **Generate KOT payload** for printing/route-to-station workflows.
- **Logout**.

### 5) Delivery flow (current scope)

Delivery is primarily an **order type** with address fields.

- **POS/Consumer** creates an order with `order_type = delivery` + `delivery_address`.
- **Tenant Admin** can optionally assign a **rider** to an order or to an entire `order_group_id` (multi-brand customer order).
- There is also a **Rider API** to list assigned orders and update `delivery_status`.

If your deployment does not include a rider app/UI yet, you can treat rider assignment/status as **optional/internal** while still supporting delivery orders operationally.

### 6) Logout flow

- Staff logout endpoint returns “logged out successfully”.
- Because auth is JWT-based, **logout is effectively client-side**: the app discards the token.

## Visual overview (simple diagrams)

### Hierarchy diagram (setup)

```mermaid
flowchart TB
  Tenant[ Tenant(Business) ]
  Brand[ Brand ]
  Branch[ Branch ]
  Menu[ Menu(Categories,Items,Variants,Addons,Modifiers,Deals) ]
  BranchMenu[ BranchMenu(Enable/Hide/PriceOverride) ]
  Users[ Users+Roles+Permissions ]

  Tenant --> Brand
  Brand --> Branch
  Tenant --> Users
  Brand --> Menu
  Menu --> BranchMenu
  Branch --> BranchMenu
```

### Order lifecycle (POS + Kitchen + Payment)

```mermaid
flowchart TB
  Login[Login]
  Shift[OpenShift]
  MenuLoad[LoadBranchMenu]
  Quote[QuoteTotals]
  Create[CreateOrder]
  Split[SplitByBrand(optional)]
  Invoice[Invoices(PerBrand+Main)]
  Pay[RecordPayment]
  KDS[KitchenPrep]
  Done[CompleteOrder]
  Logout[Logout]

  Login --> Shift --> MenuLoad --> Quote --> Create
  Create --> Split --> Invoice --> Pay --> KDS --> Done --> Logout
  Create --> Invoice
```

## Module-by-module functionalities (what each module provides)

### Authentication (staff)

- **Login**: email + password → JWT token/session payload.
- **Current user**: fetch logged-in user profile.
- **Logout**: returns success (token is discarded client-side).

### Tenants (Super Admin) + Business Settings (Tenant)

- **Tenants (Super Admin)**:
  - List/view/create/update/delete tenants.
  - Create tenant **owner credentials** during tenant creation.
  - Get/update tenant **loyalty settings**.
- **Business Settings (Tenant users)**:
  - View/update their own business name/legal name, default tax rate, loyalty enabled.

### Brands

- List/view brands for the tenant.
- Create/update/delete brands (tenant users; super admin cannot create brands without tenant context).
- Public/consumer reads exist for consumer browsing.

### Branches

- List branches (optionally filter by brand).
- Create/update/delete branches.
- Branch supports **multi-brand** (`brand_ids[]`) and defines supported order types (dine-in/takeaway/delivery) + delivery fee.
- Branch has operational flags like **menu enabled**.

### Users (staff)

- List/view users in the tenant.
- Create users (super admin can create users if `tenant_id` is provided).
- Update/delete users (requires tenant context).
- Users can be assigned to one or multiple branches.

### Roles & Permissions

- List permissions (platform-wide catalog).
- Super Admin can create/update/delete permissions.
- Tenant users can list roles, create/update/delete roles, and assign permissions to roles.

### Branch Users (branch assignments)

- List users assigned to a branch (or “all” visible branches).
- Assign users to a branch with a role (bulk assign supported).
- Remove a user from a branch.
- Branch access can be restricted by “allowed branch IDs”.

### Menu (Admin)

For each brand:

- **Categories**: create/update/delete; list/filter/search/sort.
- **Items**: create/update/delete; list/filter/search; supports “deal_only” flag.
- **Variants**: create/update/delete; list by item or brand.
- **Addons**: create/update/delete; can be category-scoped; link addons to items.
- **Modifier groups**: create/update/delete; define min/max selection; link groups to items.
- **Modifiers**: create/update/delete (options inside modifier groups).
- **Deals**:
  - View/list deals.
  - Configure deal “slots” (fixed item, choose category, choose list), quantities, and allow customization.

### Branch Menu Items (branch-level menu publishing)

- List branch menu items (by branch or tenant-wide).
- Link a menu item to a branch with:
  - **price override**
  - **enabled/disabled**
  - **hidden online**
- **Sync**: replace the branch’s menu item list with a desired list of item IDs.

### POS – Menu

- List **POS-usable branches** for the current user:
  - Only branches with an **open shift** appear.
  - Tenant users: see their tenant branches with open shifts.
  - Super admin: can see all branches with open shifts.
  - Branch-assigned users: see their assigned branches with open shifts.
- Load POS branch menu + open shift + supported order type flags.
- Fetch deal definition by menu item for POS configuration UI.

### Shifts (cash shifts)

- List/view shifts (filter by branch and status).
- Open shift: branch + user + opening cash.
- Close shift: actual cash + notes; system can compute expected cash vs actual.

### Orders (POS)

- **Quote**: compute totals (subtotal, discounts, tax/service/delivery, loyalty redemption) for a draft cart.
- **Create order**: place order with items + notes + order type + customer/table/delivery fields.
- **Order grouping**:
  - Split multi-brand cart into **one order per brand**, all linked by `order_group_id`.
  - Get group details and “main customer invoice” by `order_group_id`.
- **Invoices**:
  - Per-brand invoice per order.
  - Main customer invoice per order group.
- **Pay**: record payments against an order.

### Orders (Admin)

- List orders with filters (branch, status, date range, has rider).
- View an order.
- Update order status.
- Rider assignment:
  - List riders (tenant context).
  - Assign/change rider on a single order.
  - Assign/change rider for an entire order group (multi-brand customer order).

### Delivery / Rider (optional)

- Rider can:
  - List assigned orders.
  - View assigned order detail.
  - Update delivery status + optional failure reason.

### Payments

- Payments are recorded against orders with:
  - payment method (cash/card/etc.)
  - amount
  - reference number (optional)
  - status + timestamps

### Customers + Loyalty

- Admin customers: list/view/create/update/delete customers (tenant scoped).
- Loyalty settings exist at tenant level (enabled + configuration).
- Consumer/loyalty endpoints support:
  - balance by phone (branch identifies tenant)
  - earn/redeem effects via order creation rules

### Discounts

- Create/update/delete discounts (tenant scoped).
- Supports:
  - Auto-applied (no code) vs promo code (requires code).
  - Flat or percentage; optional min/max caps; validity window.
  - Scoping and eligibility (branches/brands/categories/items; POS-only; allowed roles).

### Kitchen (KDS)

- List orders for a branch with filters (station/status/category/brand/date range).
- View order details.
- Update order status.
- Generate KOT payload.

### Reports

- Day overview
- Sales summary
- Top items
- Shift summary

### Uploads (Admin)

- Upload image files (returns a URL).
- Public file serving endpoint for images (so images work without auth headers).

### Consumer (public APIs) — optional module

If you ship a consumer app/site, these capabilities exist:

- Browse brands (optionally by branch + search).
- Browse branches (by brand, or by location radius).
- Customer register/login/logout.
- Forgot password OTP flow (email).
- Customer profile + avatar upload + location update.
- Branch menu browsing + item detail.
- Cart: add/update/remove/clear.
- Place order + order history + order details.
- Record payment for a consumer order.
- Loyalty balance lookup.

## Notes that matter in demos (non-technical wording)

- **POS requires open shift**: If there’s no open shift, POS won’t show the branch for order-taking.
- **Multi-brand order split**: One customer order can create multiple brand orders; invoices are available both per-brand and combined.
- **Branch menu is controlled separately from the master menu**: creating items is not the same as enabling them at a branch.
- **Delivery today**: delivery is an order type; rider assignment/status exists but can be treated as optional depending on rollout.

