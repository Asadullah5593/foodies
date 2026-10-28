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

**What GST is charged on.** By default, the price after every discount and loyalty redemption. Business Settings → Tax & Charges → **"Charge GST on the menu price"** switches that to the menu price of everything ordered, extras included: discounts, BOGO, coupons, card offers, staff discount, printed vouchers and loyalty points then lower the bill but not the tax (a deal counts at its deal price — that is its menu price). Example, Rs 1,000 at 50% off with 16% GST: off = 500 + 80 = 580, on = 500 + 160 = 660. Orders without a discount are unchanged. The rule is `taxBaseFor` in `backend/src/orders/tax-pricing.ts`, called by both `quote` and `createOrder`; an order priced by it stores the base in `orders.tax_base` (null = taxed on the discounted price, as every earlier order), which the receipts ("Tax (16% on Rs 1,000)"), the admin Order Detail page ("Tax (on Rs 1,000)") and the FBR invoice (menu price as sale value, everything taken off it as the discount, the real rate) read. It applies to orders placed after the switch is saved — earlier orders keep their tax. Who turned it on or off, and when, is in the Activity Log (record type "Business setting"; every Business Settings save records what changed, before and after). Loyalty points are still earned on the order total, so a discounted order earns on the higher total.

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

Both dates are **whole days on the branch's own clock** (`branches.timezone`): "Valid until 30 Nov" covers all of 30 Nov up to midnight, and "Valid from 1 Oct" starts at 00:00 on 1 Oct. The same rule applies to the "was / now" prices on the menus, coupons, bank card offers, banners, promotions and campaigns; where there is no branch (banners, the campaign feed, welcome coupons, the app's voucher wallet) the day is read in the timezone most of the tenant's active branches use.

On the **Discounts** form each date can also take an optional **time**, in Pakistan time (the branch clock). No time = the whole day, as above. With a time the date becomes an exact moment: "Valid from Fri 23 Oct" + "Valid until Mon 26 Oct, 2:00 AM" runs all of Friday, Saturday and Sunday and ends at 2:00 AM on Monday — the way to set an offer that runs past midnight on its last night. The form sends that moment as UTC (`2026-10-25T21:00:00Z`) and reads it back on the branch clock, so the date box shows 26 Oct, not the UTC date. A time that lands exactly on midnight UTC (5:00 AM in Pakistan) is moved 1 ms inside the window so it is not read back as a whole day (`frontend/src/pages/Admin/discountWindow.ts`).

**Daily hours** (`valid_time_start` / `valid_time_end`) and **Valid days** are different: they repeat on every day the discount runs, on the branch clock — e.g. 6 PM – 11 PM, Fri and Sat only. An empty "from" means 12:00 AM, so "until 2:00 AM" alone means 12–2 AM on every day, not "until 2 AM on the last day". Daily hours cannot cross midnight (the check compares minutes within one day, so 10 PM – 2 AM would never apply); the form refuses them. The form spells out the whole window in plain words under the fields, and the list shows the same line for each discount.

How it works: the admin forms send a plain date and it is stored as midnight UTC, which is 05:00 in Pakistan. `backend/src/utils/validity-window.ts` treats a value sitting exactly on midnight UTC as a picked day and compares day against day in the timezone; a value with a time of day (the coupon minted when a customer claims a promotion expires N×24h after the claim) is still compared as an exact moment. Any new check of these columns should go through that helper rather than comparing dates directly.
