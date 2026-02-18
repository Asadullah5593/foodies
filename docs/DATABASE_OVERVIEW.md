# Rough Foodie – Database Overview

This document describes the current database schema: every table, its columns, and each relationship with cardinality and delete behavior.

---

## 1. Table index

| Table | Purpose |
|-------|--------|
| `tenants` | Top-level organization (restaurant group). |
| `users` | System users (no tenant_id; linked via tenant_users / branch_users). |
| `roles` | Role definitions; may be tenant-scoped or global (tenant_id nullable). |
| `permissions` | Permission definitions (global). |
| `role_permissions` | Many-to-many: roles ↔ permissions. |
| `tenant_users` | Links user to a tenant with a role (tenant membership). |
| `brands` | Brand under a tenant. |
| `branches` | Physical branch under a brand. |
| `branch_users` | Links user to a branch with a role (branch assignment). |
| `menu_categories` | Menu category (tenant-scoped). |
| `menu_items` | Menu item (tenant-scoped). |
| `menu_variants` | Size/variant of a menu item. |
| `menu_addons` | Add-on (tenant-scoped; optional category). |
| `menu_item_addons` | Many-to-many: menu_items ↔ menu_addons. |
| `modifier_groups` | Modifier group (brand-scoped). |
| `modifiers` | Option within a modifier group. |
| `menu_item_modifier_groups` | Many-to-many: menu_items ↔ modifier_groups. |
| `branch_menu_items` | Branch-level overrides for menu item (price, availability). |
| `orders` | POS/order record. |
| `order_items` | Line item on an order. |
| `order_item_addons` | Add-on applied to an order line. |
| `order_item_modifiers` | Modifier applied to an order line. |
| `payments` | Payment against an order. |
| `customers` | Customer (tenant-scoped; loyalty). |
| `discounts` | Discount/promo (tenant-scoped). |
| `shifts` | Cash shift at a branch. |
| `kitchen_stations` | KDS station per branch. |
| `printer_routes` | Printer routing (branch → category/station). |
| `loyalty_transactions` | Loyalty points earn/redeem/adjust. |

---

## 2. Tenancy and access

### 2.1 `tenants`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `name` | varchar | No | Display name. |
| `legal_name` | text | Yes | Legal entity name. |
| `slug` | varchar | No | Unique slug (e.g. URL). |
| `default_currency` | varchar(3) | No | Default currency code (e.g. USD). |
| `default_timezone` | varchar | No | Default timezone. |
| `default_tax_rate` | decimal(5,4) | No | Default tax rate. |
| `default_service_charge` | decimal(5,4) | No | Default service charge. |
| `loyalty_enabled` | boolean | No | Whether loyalty is enabled. |
| `status` | varchar | No | e.g. active. |
| `settings` | simple-json | Yes | Tenant settings. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations (outgoing):**

- **One-to-many → `brands`**  
  One tenant has many brands.  
  FK: `brands.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `tenant_users`**  
  One tenant has many tenant-user links.  
  FK: `tenant_users.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `orders`**  
  One tenant has many orders.  
  FK: `orders.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `discounts`**  
  One tenant has many discounts.  
  FK: `discounts.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `menu_categories`**  
  One tenant has many menu categories.  
  FK: `menu_categories.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `menu_items`**  
  One tenant has many menu items.  
  FK: `menu_items.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `menu_addons`**  
  One tenant has many menu addons.  
  FK: `menu_addons.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `customers`**  
  One tenant has many customers.  
  FK: `customers.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `roles`**  
  One tenant has many roles (tenant-scoped roles).  
  FK: `roles.tenant_id` → `tenants.id`.  
  On delete: CASCADE.  
  Note: `roles.tenant_id` is nullable for global roles.

---

### 2.2 `users`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `name` | varchar | No | Display name. |
| `email` | varchar | Yes | Unique email. |
| `email_verified_at` | timestamp | Yes | When email was verified. |
| `password` | varchar | No | Hashed password. |
| `phone` | varchar | Yes | Phone. |
| `status` | varchar | No | e.g. active. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations (outgoing):**

- **One-to-many → `tenant_users`**  
  One user can be linked to many tenants (via tenant_users).  
  FK: `tenant_users.user_id` → `users.id`.  
  On delete: CASCADE.

- **One-to-many → `branch_users`**  
  One user can be assigned to many branches.  
  FK: `branch_users.user_id` → `users.id`.  
  On delete: CASCADE.

- **One-to-many → `orders`**  
  One user can create many orders (POS operator).  
  FK: `orders.created_by` → `users.id`.  
  On delete: SET NULL.

- **One-to-many → `shifts`**  
  One user can open/close many shifts.  
  FK: `shifts.user_id` → `users.id`.  
  On delete: CASCADE.

---

### 2.3 `roles`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | Yes | Tenant (null = global role). |
| `name` | varchar | No | Display name. |
| `slug` | varchar | No | Role slug. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  Role may belong to one tenant.  
  FK: `roles.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **Many-to-many ↔ `permissions`**  
  Role has many permissions; permission can be on many roles.  
  Junction: `role_permissions` (`role_id` → `roles.id`, `permission_id` → `permissions.id`).

- **One-to-many → `tenant_users`**  
  One role is used in many tenant-user links.  
  FK: `tenant_users.role_id` → `roles.id`.  
  On delete: RESTRICT.

- **One-to-many → `branch_users`**  
  One role is used in many branch-user links.  
  FK: `branch_users.role_id` → `roles.id`.  
  On delete: RESTRICT.

---

### 2.4 `permissions`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `name` | varchar | No | Unique permission name (e.g. `reports:view`). |
| `resource` | varchar | No | Resource (e.g. reports). |
| `action` | varchar | No | Action (e.g. view). |
| `description` | text | Yes | Description. |
| `created_at` | timestamp | No | Created at. |

No foreign keys; referenced only via `role_permissions`.

---

### 2.5 `tenant_users`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `user_id` | int FK | No | User. |
| `role_id` | int FK | No | Role for this tenant. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `tenant_users.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **Many-to-one → `users`**  
  FK: `tenant_users.user_id` → `users.id`.  
  On delete: CASCADE.

- **Many-to-one → `roles`**  
  FK: `tenant_users.role_id` → `roles.id`.  
  On delete: RESTRICT.

**Semantics:** A user is a member of a tenant with a given role. A user with a row here (and no tenant_id on the JWT) is treated as super-admin for that tenant context; a user with tenant_id is a normal tenant user.

---

## 3. Brand and branch

### 3.1 `brands`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `name` | varchar | No | Brand name. |
| `slug` | varchar | No | Brand slug. |
| `description` | text | Yes | Description. |
| `logo_url` | varchar | Yes | Logo URL. |
| `is_active` | boolean | No | Whether brand is active. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `brands.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `branches`**  
  One brand has many branches.  
  FK: `branches.brand_id` → `brands.id`.  
  On delete: CASCADE.

- **One-to-many → `modifier_groups`**  
  One brand has many modifier groups.  
  FK: `modifier_groups.brand_id` → `brands.id`.  
  On delete: CASCADE.

---

### 3.2 `branches`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `brand_id` | int FK | No | Brand. |
| `name` | varchar | No | Branch name. |
| `code` | varchar | No | Unique branch code. |
| `address` | text | Yes | Address. |
| `phone` | varchar | Yes | Phone. |
| `email` | varchar | Yes | Email. |
| `timezone` | varchar | No | Timezone. |
| `operating_hours` | simple-json | Yes | Operating hours. |
| `supports_dine_in` | boolean | No | Supports dine-in. |
| `supports_takeaway` | boolean | No | Supports takeaway. |
| `supports_pickup` | boolean | No | Supports pickup. |
| `supports_delivery` | boolean | No | Supports delivery. |
| `delivery_flat_fee` | decimal(10,2) | No | Delivery flat fee. |
| `is_active` | boolean | No | Branch active. |
| `menu_enabled` | boolean | No | If false, POS/KDS/consumer menu for this branch returns empty. |
| `status` | varchar | No | e.g. active. |
| `settings` | simple-json | Yes | Branch settings. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `brands`**  
  FK: `branches.brand_id` → `brands.id`.  
  On delete: CASCADE.

- **One-to-many → `branch_users`**  
  One branch has many user assignments.  
  FK: `branch_users.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **One-to-many → `orders`**  
  Orders are placed at a branch.  
  FK: `orders.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **One-to-many → `shifts`**  
  Shifts are per branch.  
  FK: `shifts.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **One-to-many → `branch_menu_items`**  
  Branch-level menu item overrides.  
  FK: `branch_menu_items.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **One-to-many → `kitchen_stations`**  
  One branch has many kitchen stations.  
  FK: `kitchen_stations.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **One-to-many → `printer_routes`**  
  Printer routes are defined per branch.  
  FK: `printer_routes.branch_id` → `branches.id`.  
  On delete: CASCADE.

---

### 3.3 `branch_users`

Composite primary key: `(branch_id, user_id)`.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `branch_id` | int PK, FK | No | Branch. |
| `user_id` | int PK, FK | No | User. |
| `role_id` | int FK | No | Role at this branch. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `branches`**  
  FK: `branch_users.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **Many-to-one → `users`**  
  FK: `branch_users.user_id` → `users.id`.  
  On delete: CASCADE.

- **Many-to-one → `roles`**  
  FK: `branch_users.role_id` → `roles.id`.  
  On delete: RESTRICT.

**Semantics:** A user is assigned to a branch with a specific role (e.g. for POS access). Used for branch-level access and POS branch list.

---

## 4. Menu (tenant-scoped)

### 4.1 `menu_categories`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `name` | varchar | No | Category name. |
| `sort_order` | int | No | Display order. |
| `is_active` | boolean | No | Category active. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `menu_categories.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `menu_items`**  
  One category has many menu items.  
  FK: `menu_items.category_id` → `menu_categories.id`.  
  On delete: CASCADE.

- **One-to-many → `menu_addons`** (optional)  
  Addon may be scoped to a category.  
  FK: `menu_addons.category_id` → `menu_categories.id`.  
  On delete: SET NULL.

- **One-to-many → `printer_routes`** (optional)  
  Printer route may target a category.  
  FK: `printer_routes.category_id` → `menu_categories.id`.  
  On delete: SET NULL.

---

### 4.2 `menu_items`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `category_id` | int FK | No | Menu category. |
| `name` | varchar | No | Item name. |
| `slug` | varchar | No | Item slug. |
| `description` | text | Yes | Description. |
| `image_url` | varchar | Yes | Image URL. |
| `base_price` | decimal(10,2) | No | Base price. |
| `is_active` | boolean | No | Item active. |
| `sort_order` | int | No | Display order. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `menu_items.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **Many-to-one → `menu_categories`**  
  FK: `menu_items.category_id` → `menu_categories.id`.  
  On delete: CASCADE.

- **One-to-many → `menu_variants`**  
  One item has many variants (e.g. sizes).  
  FK: `menu_variants.menu_item_id` → `menu_items.id`.  
  On delete: CASCADE.

- **Many-to-many ↔ `menu_addons`**  
  Item can have many addons; addon can apply to many items.  
  Junction: `menu_item_addons` (`menu_item_id` → `menu_items.id`, `addon_id` → `menu_addons.id`).

- **One-to-many → `branch_menu_items`**  
  Branch-level overrides for this item.  
  FK: `branch_menu_items.menu_item_id` → `menu_items.id`.  
  On delete: CASCADE.

- **Many-to-many ↔ `modifier_groups`**  
  Item can have many modifier groups; group can apply to many items.  
  Junction: `menu_item_modifier_groups` (`menu_item_id` → `menu_items.id`, `modifier_group_id` → `modifier_groups.id`).

- **One-to-many → `order_items`**  
  Order line references this item (with snapshot).  
  FK: `order_items.menu_item_id` → `menu_items.id`.  
  On delete: CASCADE.

---

### 4.3 `menu_variants`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `menu_item_id` | int FK | No | Menu item. |
| `name` | varchar | No | Variant name (e.g. Large). |
| `price_modifier` | decimal(10,2) | No | Price modifier (add to base). |
| `is_default` | boolean | No | Default variant. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `menu_items`**  
  FK: `menu_variants.menu_item_id` → `menu_items.id`.  
  On delete: CASCADE.

- **One-to-many → `order_items`** (optional)  
  Order line may specify a variant.  
  FK: `order_items.variant_id` → `menu_variants.id`.  
  On delete: SET NULL.

---

### 4.4 `menu_addons`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `category_id` | int FK | Yes | If set, addon is category-specific. |
| `name` | varchar | No | Addon name. |
| `price` | decimal(10,2) | No | Price. |
| `is_active` | boolean | No | Addon active. |
| `sort_order` | int | No | Display order. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `menu_addons.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **Many-to-one → `menu_categories`** (optional)  
  FK: `menu_addons.category_id` → `menu_categories.id`.  
  On delete: SET NULL.

- **Many-to-many ↔ `menu_items`**  
  Via junction `menu_item_addons`.

- **One-to-many → `order_item_addons`**  
  Order line addon references this addon.  
  FK: `order_item_addons.addon_id` → `menu_addons.id`.  
  On delete: CASCADE.

---

### 4.5 `branch_menu_items`

Unique constraint: `(branch_id, menu_item_id)`.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `branch_id` | int FK | No | Branch. |
| `menu_item_id` | int FK | No | Menu item. |
| `price_override` | decimal(10,2) | Yes | Override price at this branch (null = use item base). |
| `is_available` | boolean | No | Available at this branch. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `branches`**  
  FK: `branch_menu_items.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **Many-to-one → `menu_items`**  
  FK: `branch_menu_items.menu_item_id` → `menu_items.id`.  
  On delete: CASCADE.

**Semantics:** Branch-specific price and availability for a menu item. Menu for a branch is tenant menu + these overrides (and `branches.menu_enabled`).

---

## 5. Modifiers (brand-scoped)

### 5.1 `modifier_groups`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `brand_id` | int FK | No | Brand. |
| `name` | varchar | No | Group name (e.g. Toppings). |
| `min_select` | int | No | Min options to select. |
| `max_select` | int | No | Max options to select. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `brands`**  
  FK: `modifier_groups.brand_id` → `brands.id`.  
  On delete: CASCADE.

- **One-to-many → `modifiers`**  
  One group has many modifier options.  
  FK: `modifiers.modifier_group_id` → `modifier_groups.id`.  
  On delete: CASCADE.

- **Many-to-many ↔ `menu_items`**  
  Via junction `menu_item_modifier_groups`.

---

### 5.2 `modifiers`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `modifier_group_id` | int FK | No | Modifier group. |
| `name` | varchar | No | Option name. |
| `price` | decimal(10,2) | No | Price (can be 0). |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `modifier_groups`**  
  FK: `modifiers.modifier_group_id` → `modifier_groups.id`.  
  On delete: CASCADE.

- **One-to-many → `order_item_modifiers`** (optional)  
  Order line modifier may reference this.  
  FK: `order_item_modifiers.modifier_id` → `modifiers.id`.  
  On delete: SET NULL.

---

## 6. Orders

### 6.1 `orders`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `brand_id` | int FK | No | Brand. |
| `branch_id` | int FK | No | Branch. |
| `order_number` | varchar | No | Unique order number. |
| `order_type` | varchar | No | e.g. dine_in, takeaway. |
| `table_number` | varchar | Yes | Table (if dine-in). |
| `customer_name` | varchar | Yes | Customer name (denormalized). |
| `customer_phone` | varchar | Yes | Customer phone (denormalized). |
| `customer_id` | int FK | Yes | Customer (if known). |
| `status` | varchar | No | e.g. placed, in_progress, completed, cancelled. |
| `source` | varchar | No | e.g. pos. |
| `delivery_address` | text | Yes | Delivery address. |
| `subtotal` | decimal(12,2) | No | Subtotal. |
| `discount_amount` | decimal(12,2) | No | Discount amount. |
| `tax_amount` | decimal(12,2) | No | Tax. |
| `service_charge` | decimal(12,2) | No | Service charge. |
| `delivery_fee` | decimal(12,2) | No | Delivery fee. |
| `total_amount` | decimal(12,2) | No | Total. |
| `discount_id` | int FK | Yes | Applied discount. |
| `discount_code` | varchar | Yes | Discount code (denormalized). |
| `placed_at` | timestamp | No | When order was placed. |
| `loyalty_points_earned` | int | No | Points earned. |
| `loyalty_points_redeemed` | int | No | Points redeemed. |
| `notes` | text | Yes | Order notes. |
| `completed_at` | timestamp | Yes | When completed. |
| `cancelled_at` | timestamp | Yes | When cancelled. |
| `created_by` | int FK | Yes | User who created (POS). |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `orders.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **Many-to-one → `brands`**  
  FK: `orders.brand_id` → `brands.id`.  
  On delete: CASCADE.

- **Many-to-one → `branches`**  
  FK: `orders.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **Many-to-one → `customers`** (optional)  
  FK: `orders.customer_id` → `customers.id`.  
  On delete: SET NULL.

- **Many-to-one → `discounts`** (optional)  
  FK: `orders.discount_id` → `discounts.id`.  
  On delete: SET NULL.

- **Many-to-one → `users`** (optional, as creator)  
  FK: `orders.created_by` → `users.id`.  
  On delete: SET NULL.

- **One-to-many → `order_items`**  
  One order has many line items.  
  FK: `order_items.order_id` → `orders.id`.  
  On delete: CASCADE.

- **One-to-many → `payments`**  
  One order has many payments.  
  FK: `payments.order_id` → `orders.id`.  
  On delete: CASCADE.

- **One-to-many → `loyalty_transactions`** (optional)  
  Loyalty transaction may reference order.  
  FK: `loyalty_transactions.order_id` → `orders.id`.  
  On delete: SET NULL.

---

### 6.2 `order_items`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `order_id` | int FK | No | Order. |
| `menu_item_id` | int FK | No | Menu item (reference + snapshot). |
| `variant_id` | int FK | Yes | Variant (e.g. size). |
| `name_snapshot` | text | Yes | Item name at order time. |
| `price_snapshot` | decimal(10,2) | Yes | Unit price at order time. |
| `quantity` | int | No | Quantity. |
| `unit_price` | decimal(10,2) | No | Unit price. |
| `subtotal` | decimal(10,2) | No | Line subtotal. |
| `notes` | text | Yes | Line notes. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `orders`**  
  FK: `order_items.order_id` → `orders.id`.  
  On delete: CASCADE.

- **Many-to-one → `menu_items`**  
  FK: `order_items.menu_item_id` → `menu_items.id`.  
  On delete: CASCADE.

- **Many-to-one → `menu_variants`** (optional)  
  FK: `order_items.variant_id` → `menu_variants.id`.  
  On delete: SET NULL.

- **One-to-many → `order_item_addons`**  
  One line can have many addons.  
  FK: `order_item_addons.order_item_id` → `order_items.id`.  
  On delete: CASCADE.

- **One-to-many → `order_item_modifiers`**  
  One line can have many modifiers.  
  FK: `order_item_modifiers.order_item_id` → `order_items.id`.  
  On delete: CASCADE.

---

### 6.3 `order_item_addons`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `order_item_id` | int FK | No | Order line. |
| `addon_id` | int FK | No | Menu addon. |
| `quantity` | int | No | Quantity (default 1). |
| `unit_price` | decimal(10,2) | No | Price at order time. |
| `subtotal` | decimal(10,2) | No | Line addon subtotal. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `order_items`**  
  FK: `order_item_addons.order_item_id` → `order_items.id`.  
  On delete: CASCADE.

- **Many-to-one → `menu_addons`**  
  FK: `order_item_addons.addon_id` → `menu_addons.id`.  
  On delete: CASCADE.

---

### 6.4 `order_item_modifiers`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `order_item_id` | int FK | No | Order line. |
| `modifier_id` | int FK | Yes | Modifier (optional if snapshot only). |
| `name_snapshot` | text | Yes | Modifier name at order time. |
| `price_snapshot` | decimal(10,2) | Yes | Price at order time. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `order_items`**  
  FK: `order_item_modifiers.order_item_id` → `order_items.id`.  
  On delete: CASCADE.

- **Many-to-one → `modifiers`** (optional)  
  FK: `order_item_modifiers.modifier_id` → `modifiers.id`.  
  On delete: SET NULL.

---

### 6.5 `payments`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `order_id` | int FK | No | Order. |
| `payment_method` | varchar | No | e.g. cash, card. |
| `amount` | decimal(10,2) | No | Amount. |
| `reference_number` | varchar | Yes | External reference. |
| `status` | varchar | No | e.g. pending, completed. |
| `processed_at` | timestamp | Yes | When processed. |
| `paid_at` | timestamp | Yes | When paid. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `orders`**  
  FK: `payments.order_id` → `orders.id`.  
  On delete: CASCADE.

---

## 7. Customers, discounts, loyalty

### 7.1 `customers`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `phone` | varchar | No | Primary contact. |
| `name` | varchar | Yes | Customer name. |
| `loyalty_points_balance` | int | No | Current points. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `customers.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `orders`** (optional from order side)  
  Orders may reference customer via `orders.customer_id`.

- **One-to-many → `loyalty_transactions`**  
  One customer has many loyalty transactions.  
  FK: `loyalty_transactions.customer_id` → `customers.id`.  
  On delete: CASCADE.

---

### 7.2 `discounts`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `tenant_id` | int FK | No | Tenant. |
| `name` | varchar | No | Discount name. |
| `code` | varchar | Yes | Unique code (optional). |
| `type` | varchar | No | flat, percentage. |
| `value` | decimal(10,2) | No | Amount or percentage. |
| `min_order_amount` | decimal(10,2) | Yes | Min order to apply. |
| `max_discount_amount` | decimal(10,2) | Yes | Cap (for percentage). |
| `is_active` | boolean | No | Active. |
| `pos_only` | boolean | No | POS only. |
| `allowed_roles` | simple-json | Yes | Roles that can apply. |
| `valid_from` | timestamp | Yes | Validity start. |
| `valid_until` | timestamp | Yes | Validity end. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `tenants`**  
  FK: `discounts.tenant_id` → `tenants.id`.  
  On delete: CASCADE.

- **One-to-many → `orders`** (optional from order side)  
  Orders may reference discount via `orders.discount_id`.

---

### 7.3 `loyalty_transactions`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `customer_id` | int FK | No | Customer. |
| `order_id` | int FK | Yes | Order (null for adjust). |
| `points` | int | No | Points (signed). |
| `type` | varchar | No | earn, redeem, adjust. |
| `created_at` | timestamp | No | Created at. |

**Relations:**

- **Many-to-one → `customers`**  
  FK: `loyalty_transactions.customer_id` → `customers.id`.  
  On delete: CASCADE.

- **Many-to-one → `orders`** (optional)  
  FK: `loyalty_transactions.order_id` → `orders.id`.  
  On delete: SET NULL.

---

## 8. Shifts, kitchen, printing

### 8.1 `shifts`

Unique constraint: `(branch_id, shift_number)`.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `branch_id` | int FK | No | Branch. |
| `user_id` | int FK | No | User who opened. |
| `shift_number` | varchar | No | Shift number. |
| `opening_cash` | decimal(12,2) | No | Opening cash. |
| `closing_cash` | decimal(12,2) | Yes | Closing cash. |
| `expected_cash` | decimal(12,2) | Yes | Expected cash. |
| `status` | varchar | No | open, closed. |
| `opened_at` | timestamp | No | When opened. |
| `closed_at` | timestamp | Yes | When closed. |
| `notes` | text | Yes | Notes. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `branches`**  
  FK: `shifts.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **Many-to-one → `users`**  
  FK: `shifts.user_id` → `users.id`.  
  On delete: CASCADE.

**Semantics:** One open shift per branch at a time (enforced in application).

---

### 8.2 `kitchen_stations`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `branch_id` | int FK | No | Branch. |
| `name` | varchar | No | Station name. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `branches`**  
  FK: `kitchen_stations.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **One-to-many → `printer_routes`** (optional)  
  Printer route may target a station.  
  FK: `printer_routes.station_id` → `kitchen_stations.id`.  
  On delete: SET NULL.

---

### 8.3 `printer_routes`

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | int PK | No | Primary key. |
| `branch_id` | int FK | No | Branch. |
| `category_id` | int FK | Yes | Route by category (optional). |
| `station_id` | int FK | Yes | Route by kitchen station (optional). |
| `printer_name` | varchar | No | Printer identifier. |
| `created_at` | timestamp | No | Created at. |
| `updated_at` | timestamp | No | Updated at. |

**Relations:**

- **Many-to-one → `branches`**  
  FK: `printer_routes.branch_id` → `branches.id`.  
  On delete: CASCADE.

- **Many-to-one → `menu_categories`** (optional)  
  FK: `printer_routes.category_id` → `menu_categories.id`.  
  On delete: SET NULL.

- **Many-to-one → `kitchen_stations`** (optional)  
  FK: `printer_routes.station_id` → `kitchen_stations.id`.  
  On delete: SET NULL.

**Semantics:** Defines which printer receives orders (or order items) for a branch, optionally filtered by category and/or kitchen station.

---

## 9. Junction / join tables (no extra columns)

| Table | Left entity | Right entity | Purpose |
|-------|-------------|--------------|---------|
| `role_permissions` | `roles` (role_id) | `permissions` (permission_id) | Role–permission assignment. |
| `menu_item_addons` | `menu_items` (menu_item_id) | `menu_addons` (addon_id) | Which addons apply to which items. |
| `menu_item_modifier_groups` | `menu_items` (menu_item_id) | `modifier_groups` (modifier_group_id) | Which modifier groups apply to which items. |

---

## 10. Relationship summary (by entity)

- **Tenant:** 1 → N brands, tenant_users, orders, menu_categories, menu_items, menu_addons, discounts, customers, roles.
- **User:** N ← tenant_users, branch_users; 1 → N orders (created_by), shifts.
- **Role:** N ← tenant_users, branch_users; N ↔ M permissions (role_permissions).
- **Brand:** N ← tenants; 1 → N branches, modifier_groups.
- **Branch:** N ← brands; 1 → N branch_users, orders, shifts, branch_menu_items, kitchen_stations, printer_routes.
- **Menu category:** N ← tenants; 1 → N menu_items; N ← menu_addons (optional), printer_routes (optional).
- **Menu item:** N ← menu_categories, tenants; 1 → N menu_variants, branch_menu_items, order_items; N ↔ M menu_addons, modifier_groups.
- **Menu variant:** N ← menu_items; 1 → N order_items (optional).
- **Menu addon:** N ← tenants; N ← menu_categories (optional); N ↔ M menu_items; 1 → N order_item_addons.
- **Branch menu item:** N ← branches, menu_items (unique per branch+item).
- **Modifier group:** N ← brands; 1 → N modifiers; N ↔ M menu_items.
- **Modifier:** N ← modifier_groups; 1 → N order_item_modifiers (optional).
- **Order:** N ← tenants, brands, branches; N ← customers, discounts, users (optional); 1 → N order_items, payments; N ← loyalty_transactions (optional).
- **Order item:** N ← orders, menu_items; N ← menu_variants (optional); 1 → N order_item_addons, order_item_modifiers.
- **Order item addon:** N ← order_items, menu_addons.
- **Order item modifier:** N ← order_items; N ← modifiers (optional).
- **Payment:** N ← orders.
- **Customer:** N ← tenants; 1 → N loyalty_transactions; N ← orders (optional).
- **Discount:** N ← tenants; N ← orders (optional).
- **Shift:** N ← branches, users.
- **Kitchen station:** N ← branches; N ← printer_routes (optional).
- **Printer route:** N ← branches; N ← menu_categories (optional), kitchen_stations (optional).
- **Loyalty transaction:** N ← customers; N ← orders (optional).

This overview reflects the current TypeORM entities and migrations. For a visual ERD, see [DATABASE_ERD.md](./DATABASE_ERD.md).
