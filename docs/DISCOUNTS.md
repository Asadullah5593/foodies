# How discounts work

## Two-tier hierarchy

1. **Auto-applied discounts (default)** – Discounts that **do not require a code** are applied automatically when the order matches their scope and eligibility (branch, brand, category, or products). These are configured in **Admin → Discounts** with **"Requires code (coupon/promo only)"** **unchecked**. Leave **Code** empty for auto-apply.
2. **Coupon / promo (code)** – An **additional** layer: when the customer has a coupon, they enter the **code** in POS. Only discounts that **require a code** (checkbox checked) are applied when that code is entered. The coupon discount is applied **on top of** the auto discount (to the amount after the auto discount).

So: **Original amount → Auto discount → Coupon discount (if code entered) → Tax/service/delivery → Total payable.**

## Overview

Discounts are **tenant-scoped**. You create them in **Admin → Discounts**. Each discount has:
- **Requires code**: when **unchecked**, the discount is **auto-applied** when scope & branch match (no code needed). When **checked**, it is **coupon/promo only** (user must enter the code).
- Type (flat or percentage), value, optional min/max, validity dates.
- **Apply to**: whole order, selected categories, or selected products.
- **Valid at**: all branches/brands or selected ones.

## POS: Original amount, Discount amount, Total payable

In the POS order panel you now see:

- **Original amount** – subtotal of all items (before discount).
- **Discount** – amount taken off when a valid discount code is applied (and the code name if applied).
- **Total payable** – final amount (original − discount, then + tax + service charge + delivery when applicable).

The POS calls a **quote** API as you add items or change the discount code, so the breakdown updates live. When you click **Create Order**, the server applies the same logic and saves the order with the discounted total.

## Applying a discount in POS

1. Add items to the order.
2. Enter the **discount code** (e.g. `SAVE10`).
3. The panel shows **Original amount**, **Discount**, and **Total payable**.
4. Click **Create Order**. The order is stored with the discount and the confirmation shows the final total (e.g. "Order #123 created. Total: Rs. 450.00").

## Discount scopes (Apply to)

When creating/editing a discount you choose **Apply to**:

- **Whole order** – discount applies to the full order subtotal (default).
- **Selected categories** – discount applies only to the portion of the order that comes from items in the selected menu categories.
- **Selected products** – discount applies only to the portion from the selected menu items.

The discount value (flat or percentage) is applied to this **discountable amount** only, and is still capped by **Max discount amount** if set.

## Eligibility (Valid at)

You also choose **Valid at**:

- **All branches & brands** – the code can be used at any branch (default).
- **Selected branches** – the code is valid only when the order is placed at one of the selected branches.
- **Selected brands** – the code is valid only when the order is from a branch that belongs to one of the selected brands.

All of this is **per tenant**: discounts and their scope/eligibility are isolated by tenant.

## Discount types

- **Flat**: fixed amount off the discountable portion (e.g. Rs. 50). Capped by that portion and optionally by "Max discount amount".
- **Percentage**: percent off the discountable portion (e.g. 10%). Optionally capped by "Max discount amount".

Optional **Min order amount**: discount applies only if order subtotal ≥ this value.

Optional **Valid from / Valid until**: discount only applied within this date range.
