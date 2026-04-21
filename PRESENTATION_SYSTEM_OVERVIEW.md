# Foodies — Client Presentation Notes

This document is written as **client-facing** content you can copy into a presentation (PPT). It explains **what each area does** and provides a simple **end-to-end overview**.

---

## Overall system summary (what the system is)

Foodies is a restaurant operations system that combines:

- A **staff system** for management, point-of-sale, and kitchen operations

The system is organized around:

- **Business** → **Brand(s)** → **Branch(es)/Locations**
- You build a menu once, then each branch controls **availability** and **pricing** for day-to-day selling.

Key points to highlight in demos:

- **Shift-based POS**: opening a shift is part of daily operations and helps track sales and cash handling at a branch.
- **Kitchen screen (KDS)**: shows incoming orders for preparation and lets kitchen staff update progress.

---

## Who uses it (roles)

- **Owner / Manager**
  - Sets up branches, builds the menu, manages staff access, and reviews reports.
- **Cashier (POS)**
  - Takes orders, applies discounts (if allowed), collects payments, and provides invoices/receipts.
- **Kitchen staff**
  - Uses the kitchen screen to prepare orders and update statuses.
- **Rider / Delivery staff (optional)**
  - Sees assigned deliveries and updates delivery status (if enabled).

---

## System areas (what each part does)

## Login & access

- Staff users log in with their credentials.
- Owners/managers decide who can access which areas (Admin, POS, Kitchen) and which locations they can operate at.

## Business setup (branches)

- Create and manage **branches/locations** (where operations happen).
- Configure what each branch supports (dine-in, takeaway, delivery) and branch details.

## Staff management

- Create staff accounts.
- Assign roles and location access (who can run POS, who can work kitchen, who can manage settings).

## Menu management (build once, sell per branch)

- Build the menu structure:
  - Categories (e.g., Starters, Burgers)
  - Items (with images, descriptions, base pricing)
  - Options such as sizes/variants, addons, and modifiers (e.g., toppings)
  - Deals/combos (where applicable)
- Publish and control the menu at each branch:
  - Enable/disable items
  - Branch-specific price overrides

## POS (order taking and billing)

- Select a branch and start daily operations (shift).
- Take orders quickly with item customization and notes.
- Apply discounts (where allowed).
- Generate invoices/receipts.

## Payments

- Record payments against orders (cash/card/etc.).
- Support split/partial payments when required by operations.

## Kitchen screen (KDS)

- Live kitchen screen showing new and in-progress orders.
- View order details and update preparation status.

## Customers & loyalty

- Maintain customer records.
- Configure loyalty rules (earn/redeem) and track balances.

## Discounts & promotions

- Create automatic or code-based promotions.
- Control validity dates, eligibility rules, and where the discount can be used.

## Shifts (daily cash management)

- Open and close shifts.
- Track opening cash, closing cash, and shift notes for daily reconciliation.

## Reports

- Operational reporting such as daily sales overview, top items, and shift summaries.

## Delivery and rider workflows (optional)

- Support delivery orders with address details.
- Assign deliveries to riders and track delivery status (if enabled).

---

## Interfaces (what screens/users see)

## Management (owner/manager)

- Business setup: brands and branches/locations
- Staff setup: users, roles, and location access
- Menu management: categories, items, options, deals
- Branch menu control: availability and branch pricing
- Discounts and loyalty settings
- Reporting and order oversight

## POS (cashier)

- Start shift and operate the register at a branch
- Take orders with item customization and notes
- Apply allowed discounts
- Collect payments and provide invoices/receipts

## Kitchen screen (kitchen staff)

- View live incoming orders for a branch
- Update preparation status until completion

## Delivery (optional)

- Assign deliveries and track delivery status (if enabled)

---

## End-to-end flow summary (slide-friendly)

- **Setup**
  - Owner/manager creates brands and branches → creates staff access → builds menu → enables items and pricing per branch.
- **Daily operations**
  - Open shift → POS takes orders → payment recorded → kitchen prepares → order completed.
