# Printed vouchers

The paper "Discount Coupon Book" a customer hands over at the till: "Any large
pizza for Rs 999", "Classic Smashed Burger Meal for Rs 799", "30% off".

Not to be confused with **Coupons** (`discounts` rows with `offer_kind = 'coupon'`,
and their per-customer instances in the `vouchers` table), which belong to the
customer app. Printed vouchers have their own table (`printed_vouchers`), their
own admin page and their own permissions, and never reach the app or the
website.

## Rules

- **One voucher per order.** A request may carry one `voucher_id`.
- **It replaces every other discount.** When a voucher takes something off the
  cart it is the only pricing stage: no automatic discount or BOGO, product
  promotion, till-activated offer, staff discount, coupon code, bank card offer
  or loyalty redemption. The customer still earns loyalty points.
- **One brand each.** A voucher is offered only when the cart is that brand's.
- **Fixed price** (`fixed_price`): ONE qualifying item is charged at the voucher
  price — the line where the customer saves most. Other items are full price,
  extras (toppings, add-ons, upgrades) are charged on top, and a voucher never
  raises a price.
- **Meal vouchers** are fixed-price vouchers with `included_modifier_ids`: the
  options the price also covers (the item's "Add Fries & Drink"). The item must
  be ordered with one of them. Several ids are alternatives, not a checklist.
- **Percentage** (`percentage`): N% off the qualifying lines, extras included;
  an optional maximum in rupees.
- **Scope** is a list of categories and/or products. A percentage voucher with
  neither covers the brand's whole menu; a fixed price must have a scope.
- **The printed price is always honoured.** The voucher stage ignores the cost
  floor and the tenant's max-total-discount cap.
- **Deal lines are never touched**, as for every offer.
- **Where and when:** order types, branches and valid from/until are per
  voucher. Dates are whole days, both inclusive, in the branch's timezone
  (`branches.timezone`): "valid until 30/11" works all day on the 30th.
- **No usage limit and no serial numbers.** The system cannot tell whether a
  paper voucher was used before; staff collect it. The order records which
  voucher it used, which is what a per-customer rule would be built on.

## Where it lives

| Piece | Location |
|---|---|
| Pricing and eligibility rules (pure, unit-tested) | `backend/src/orders/printed-voucher-pricing.ts` |
| Authorization, the exclusive stage, order fields | `OrdersService` — `authorizeVoucher`, `assertVoucherStandsAlone`, `resolveStagedOffers` |
| Admin CRUD, till list, form pick-lists, report | `backend/src/printed-vouchers/` (`/api/admin/printed-vouchers`) |
| Admin page / report page | `frontend/src/pages/Admin/PrintedVouchers.tsx`, `PrintedVoucherReport.tsx` |
| Till buttons | `frontend/src/pages/POS/components/VoucherPicker.tsx` |

`quote` reports why a requested voucher was not applied (`voucher_error`) and
prices the cart without it; `createOrder` refuses the order. The voucher fields
are added to the quote response only when a voucher was requested, so the
consumer app and website — which call the same `quote()` — receive the response
they always have.

On `orders`: `printed_voucher_id` (ON DELETE SET NULL), `voucher_name` (snapshot
— also the marker for "this order used a voucher"), `voucher_discount_amount`
(one of the splits that sum to `discount_amount`) and `voucher_by`.

## Permissions

`printed-vouchers:view | create | edit | delete` for the admin page and the
report, `printed-vouchers:apply` for the till. The migration grants each to the
roles that already hold the matching `staff-discounts:*` permission (`apply`
also follows `orders:apply-manual-offer`). Brand-locked admins see and manage
only their own brands' vouchers and redemptions.

## Not supported (yet)

- Kiosk carts finalized at the till, and consumer app / web orders.
- A per-customer or per-booklet usage limit.
- Restricting a voucher to one size of an item (every pizza and box currently
  has a single size).
