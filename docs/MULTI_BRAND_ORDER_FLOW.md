# Multi-Brand Order Split – Flow

When a customer adds items from **multiple brands** to the cart and places one order, the system **splits the cart by brand**, creates **one order per brand**, and groups them with a **single order group ID** for viewing and invoicing.

---

## 1. High-level flow

```
Customer cart (e.g. aa from Brand A, bb from B, cc from C)
        │
        ▼
   Place Order (single request)
        │
        ▼
   Backend: group line items by (branch_id, brand_id)
        │
        ├──► Order 1 (Branch 1, Brand A): items [aa]   ──► Branch 1 receives this order
        ├──► Order 2 (Branch 1, Brand B): items [bb]   ──► Branch 1 receives this order
        └──► Order 3 (Branch 2, Brand C): items [cc]   ──► Branch 2 receives this order
        │
        └──► All linked by same order_group_id
                    │
                    ▼
             Main customer invoice (breakdown + gross total)
```

---

## 2. Detailed flow (Mermaid)

```mermaid
flowchart TB
    subgraph Cart["POS Cart"]
        A[Item aa - Brand A]
        B[Item bb - Brand B]
        C[Item cc - Brand C]
    end

    subgraph Create["Create Order (POST /pos/orders)"]
        D[Receive cart + table/customer/discount]
        E[Resolve menu items & brand_id per line]
        F[Compute subtotals & allocate discounts to lines]
        G[Generate order_group_id UUID]
        H[Group lines by (branch_id, brand_id)]
    end

    subgraph PerBrand["Per-brand order creation (per branch)"]
        I1[Order 1: branch_1, brand A, order_group_id]
        I2[Order 2: branch_1, brand B, order_group_id]
        I3[Order 3: branch_2, brand C, order_group_id]
    end

    subgraph Invoices["Invoicing"]
        J1[Per-brand invoice: GET /pos/orders/:id/invoice]
        J2[Main invoice: GET /pos/orders/group/:id/main-invoice]
    end

    Cart --> D
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I1
    H --> I2
    H --> I3
    I1 --> J1
    I2 --> J1
    I3 --> J1
    I1 & I2 & I3 --> J2
```

---

## 3. Sequence (customer places order)

```mermaid
sequenceDiagram
    participant POS
    participant API
    participant DB

    POS->>API: POST /pos/orders (branch_id, items, table, discount_code...)
    API->>API: Load branch, tenant, validate shift
    API->>API: For each item: resolve menu_item, brand_id, price, subtotal
    API->>API: Resolve auto + coupon discount; allocate to lines
    API->>API: Generate order_group_id (UUID)
    API->>API: Group items by brand_id

    loop For each brand
        API->>DB: Create order (brand_id, order_group_id, totals)
        API->>DB: Create order_items for that brand's lines
    end

    API-->>POS: { order_group_id, orders: [ { id, order_number, total_amount }, ... ] }
    POS->>POS: Show success: "3 orders created. Group: abc123… | Gross total: Rs X"
```

---

## 4. Data model (relevant parts)

| Concept | Description |
|--------|-------------|
| **Order** | One order per brand. `brand_id` = that brand; `order_group_id` = same UUID for all orders from one placement. |
| **Order group** | Set of orders sharing the same `order_group_id`. Used to “view this customer’s order” and for the main invoice. |
| **Per-brand invoice** | One order → one invoice: brand, category, item breakdown, totals for that brand. |
| **Main customer invoice** | One per order group: breakdown by brand (each brand’s items + total) + **gross total**. |

---

## 5. Multi-branch behaviour

When items in the cart can come from **different branches** (e.g. Branch 1 has Brand A and B, Branch 2 has Brand C):

- Each cart line may optionally include **`branch_id`** (if omitted, the request’s **`branch_id`** is used).
- The backend groups lines by **(branch_id, brand_id)**. So:
  - **Branch 1** gets one order per brand (e.g. Order for Brand A, Order for Brand B).
  - **Branch 2** gets one order for its brand (e.g. Order for Brand C).
- Each order is stored with the **correct `branch_id`** so the right branch receives and fulfils it.
- All orders from one placement still share the same **`order_group_id`**.
- Every branch that has at least one order in the group must have an **open shift** (POS).

---

## 6. API summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/pos/orders` | Place order; cart is split by brand; returns `order_group_id` + `orders[]`. |
| GET | `/pos/orders/group/:orderGroupId` | Get all orders in a group (view customer order). |
| GET | `/pos/orders/:id/invoice` | Per-brand invoice (brand, category, item breakdown). |
| GET | `/pos/orders/group/:orderGroupId/main-invoice` | Main customer invoice (breakdown + gross total). |

---

## 7. Where to view the unified (customer) invoice

- **POS:** After placing an order, the **Customer invoice** modal opens automatically with the main invoice (breakdown by brand + gross total). You can also click **“View customer invoice”** (below **Create Order**) to open it again for the last order group.
- **API:** `GET /pos/orders/group/:orderGroupId/main-invoice` returns the same data (breakdown by order/brand + `gross_total`) for use in print, email, or other UIs.

---

## 8. Discount and fee rules

- **Discounts** (auto + coupon) are resolved at **full-cart** level, then **allocated to each line** (by existing scope/eligibility).
- When splitting by brand, each brand’s **order** gets the **sum of allocated discount** for that brand’s lines.
- **Tax** and **service charge** are applied **per order** (per brand) on that order’s (subtotal − discount).
- **Delivery fee** is applied **once** to the **first** order in the group (by brand id order).

---

## 9. Frontend (POS)

- Cart is unchanged: user adds items from any brand; each menu item has `brand_id` from the menu API.
- On **Create Order**, the same payload is sent; backend does the split.
- On success, response is always `{ order_group_id, orders }`. Frontend shows:
  - 1 order: “Order #X created. Total: Rs Y (Group: …)”
  - N orders: “N orders created. Group: … | Gross total: Rs Z”

Use **order_group_id** to:
- Look up all orders for this placement (`GET /pos/orders/group/:orderGroupId`).
- Generate the main customer invoice (`GET /pos/orders/group/:orderGroupId/main-invoice`).
