# Rough Foodie – Database ERD (High Level)

High-level entity-relationship diagram of the current database schema.

## Entity Relationship Diagram

```mermaid
erDiagram
    %% === TENANCY & ACCESS ===
    tenants ||--o{ brands : "has"
    tenants ||--o{ tenant_users : "has"
    tenants ||--o{ orders : "has"
    tenants ||--o{ menu_categories : "has"
    tenants ||--o{ menu_items : "has"
    tenants ||--o{ menu_addons : "has"
    tenants ||--o{ discounts : "has"
    tenants ||--o{ customers : "has"
    tenants ||--o{ roles : "has"

    users ||--o{ tenant_users : "in"
    users ||--o{ branch_users : "in"
    users ||--o{ orders : "created_by"
    users ||--o{ shifts : "opens"

    roles ||--o{ tenant_users : "assigned"
    roles ||--o{ branch_users : "assigned"

    tenant_users }o--|| tenants : "tenant"
    tenant_users }o--|| users : "user"
    tenant_users }o--|| roles : "role"

    %% === BRAND & BRANCH ===
    brands ||--o{ branches : "has"
    brands ||--o{ modifier_groups : "has"

    branches ||--o{ branch_users : "has"
    branches ||--o{ orders : "at"
    branches ||--o{ shifts : "at"
    branches ||--o{ branch_menu_items : "overrides"
    branches ||--o{ kitchen_stations : "has"
    branches ||--o{ printer_routes : "has"

    branch_users }o--|| branches : "branch"
    branch_users }o--|| users : "user"
    branch_users }o--|| roles : "role"

    %% === MENU (tenant-scoped) ===
    menu_categories ||--o{ menu_items : "contains"
    menu_addons }o--o| menu_categories : "category"

    menu_items ||--o{ menu_variants : "has"
    menu_items ||--o{ branch_menu_items : "overridden_by"
    menu_items ||--o{ order_items : "snapshot"

    branch_menu_items }o--|| branches : "branch"
    branch_menu_items }o--|| menu_items : "menu_item"

    modifier_groups ||--o{ modifiers : "contains"

    %% === ORDERS ===
    orders }o--o| customers : "customer"
    orders }o--o| discounts : "discount"
    orders ||--o{ order_items : "contains"
    orders ||--o{ payments : "has"

    order_items }o--o| menu_variants : "variant"
    order_items ||--o{ order_item_addons : "has"
    order_items ||--o{ order_item_modifiers : "has"

    order_item_addons }o--|| menu_addons : "addon"
    order_item_modifiers }o--o| modifiers : "modifier"

    %% === BRANCH OPERATIONS ===
    shifts }o--|| branches : "branch"
    shifts }o--|| users : "user"

    kitchen_stations }o--|| branches : "branch"
    printer_routes }o--|| branches : "branch"
    printer_routes }o--o| menu_categories : "category"
    printer_routes }o--o| kitchen_stations : "station"

    %% === LOYALTY ===
    customers ||--o{ loyalty_transactions : "has"
    loyalty_transactions }o--o| orders : "order"

    %% Entity definitions (key attributes only)
    tenants {
        int id PK
        string name
        string slug UK
    }
    users {
        int id PK
        string email UK
        string name
    }
    roles {
        int id PK
        int tenant_id FK "nullable for global"
        string name
    }
    brands {
        int id PK
        int tenant_id FK
        string name
    }
    branches {
        int id PK
        int brand_id FK
        string name
        string code
        boolean menu_enabled
    }
    menu_categories {
        int id PK
        int tenant_id FK
        string name
        int sort_order
    }
    menu_items {
        int id PK
        int tenant_id FK
        int category_id FK
        string name
        decimal base_price
    }
    menu_variants {
        int id PK
        int menu_item_id FK
        string name
        decimal price_modifier
    }
    menu_addons {
        int id PK
        int tenant_id FK
        string name
        decimal price
    }
    modifier_groups {
        int id PK
        int brand_id FK
        string name
    }
    modifiers {
        int id PK
        int modifier_group_id FK
        string name
        decimal price
    }
    orders {
        int id PK
        int tenant_id FK
        int brand_id FK
        int branch_id FK
        string order_number UK
        string status
        decimal total_amount
        timestamp placed_at
    }
    order_items {
        int id PK
        int order_id FK
        int menu_item_id FK
        int quantity
        decimal unit_price
        decimal subtotal
    }
    order_item_addons {
        int id PK
        int order_item_id FK
        int menu_addon_id FK
        decimal price
    }
    order_item_modifiers {
        int id PK
        int order_item_id FK
        int modifier_id FK
    }
    payments {
        int id PK
        int order_id FK
        string method
        decimal amount
    }
    customers {
        int id PK
        int tenant_id FK
        string email
        int loyalty_points
    }
    discounts {
        int id PK
        int tenant_id FK
        string code
        string type
    }
    shifts {
        int id PK
        int branch_id FK
        int user_id FK
        string status
        timestamp opened_at
        timestamp closed_at
    }
    kitchen_stations {
        int id PK
        int branch_id FK
        string name
    }
    printer_routes {
        int id PK
        int branch_id FK
        string printer_name
    }
    loyalty_transactions {
        int id PK
        int customer_id FK
        int points
        string type
    }
```

## Logical groupings

| Group | Entities | Description |
|-------|----------|-------------|
| **Tenancy** | `tenants`, `users`, `roles`, `tenant_users`, `permissions` | Multi-tenant org and user access |
| **Brand & branch** | `brands`, `branches`, `branch_users`, `branch_menu_items` | Brands under tenant; branches under brand; branch-level menu overrides |
| **Menu** | `menu_categories`, `menu_items`, `menu_variants`, `menu_addons` | Tenant-scoped catalog |
| **Modifiers** | `modifier_groups`, `modifiers` | Brand-scoped modifier groups and options |
| **Orders** | `orders`, `order_items`, `order_item_addons`, `order_item_modifiers`, `payments` | POS orders and line items |
| **Operations** | `shifts`, `kitchen_stations`, `printer_routes` | Branch operations and KDS/printing |
| **Loyalty** | `customers`, `loyalty_transactions` | Customer and points (optional) |
| **Promotions** | `discounts` | Tenant-scoped discounts applied to orders |

## Key relationships

- **Tenant** is the top-level scope: owns brands, menu (categories/items/addons), discounts, customers, and roles.
- **Brand** belongs to one tenant; **Branch** belongs to one brand. Orders are placed at a branch.
- **Menu** is defined at tenant level; **branch_menu_items** can override price/availability per branch.
- **Order** is tied to tenant, brand, branch, and optionally customer and discount. **Order items** reference menu items/variants and can have addons and modifiers.
- **Shifts** are per branch and per user (one open shift per branch).
- **Printer routes** link a branch to a printer, optionally by menu category and/or kitchen station.

## PDF export

A pre-generated PDF is included: **[DATABASE_ERD.pdf](./DATABASE_ERD.pdf)**.

To regenerate it (requires Node and Puppeteer):

```bash
npx @mermaid-js/mermaid-cli -i docs/database-erd.mmd -o docs/DATABASE_ERD.pdf -e pdf -f
```

Other options:

- **Mermaid Live:** Copy the `erDiagram` block from this file into [mermaid.live](https://mermaid.live) and use **Actions → Export as PDF**.
- **VS Code:** Use a Mermaid/Markdown preview extension and print to PDF from the preview.
