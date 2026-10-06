# Printed vouchers

The paper "Discount Coupon Book" a customer hands over at the till: "Any large
pizza for Rs 999", "Classic Smashed Burger Meal for Rs 799", "30% off".

Not to be confused with **Coupons** (`discounts` rows with `offer_kind = 'coupon'`,
and their per-customer instances in the `vouchers` table), which belong to the
customer app. Printed vouchers have their own table (`printed_vouchers`), their
own admin page and their own permissions, and never reach the app or the
website.

## Rules

- **Several vouchers per order.** A request carries `vouchers`, a list of
  `{ voucher_id, quantity }` — one entry per voucher kind with how many papers
  the customer handed over (`voucher_id` alone is the one-voucher shorthand).
  Fixed-price vouchers combine: each paper prices ONE item, so three pizza
  vouchers price three pizzas and Peperi Co's three meal vouchers can sit on
  one order, each needing its own item. A **percentage voucher stands alone**
  — handed over with any other paper it is refused, in either direction.
- **They replace every other discount.** When vouchers take something off the
  cart they are the only pricing stage: no automatic discount or BOGO, product
  promotion, till-activated offer, staff discount, coupon code, bank card offer
  or loyalty redemption. The customer still earns loyalty points.
- **One brand each.** A voucher is offered only when the cart is that brand's.
- **Fixed price** (`fixed_price`): each paper charges ONE qualifying item at
  the voucher price — the item left in the cart where the customer saves most,
  so with more pizzas than vouchers the dearest ones get the voucher price. An
  item never carries two papers. Other items are full price, extras (toppings,
  add-ons, upgrades) are charged on top, and a voucher never raises a price.
  More papers than qualifying items is refused ("Only 2 items in the cart
  qualify, but 3 vouchers were applied"), as is a paper whose every item
  already carries another voucher.
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
| Pricing and eligibility rules (pure, unit-tested) | `backend/src/orders/printed-voucher-pricing.ts` (`evaluateVouchers`) |
| Authorization, the exclusive stage, order fields | `OrdersService` — `voucherRequestsOf`, `authorizeVouchers`, `assertVoucherStandsAlone`, `resolveStagedOffers` |
| Admin CRUD, till list, form pick-lists, report | `backend/src/printed-vouchers/` (`/api/admin/printed-vouchers`) |
| Admin page / report page | `frontend/src/pages/Admin/PrintedVouchers.tsx`, `PrintedVoucherReport.tsx` |
| Till buttons | `frontend/src/pages/POS/components/VoucherPicker.tsx` |

`quote` reports why the requested vouchers were not applied (`voucher_error`,
naming the voucher that stopped them) and prices the cart without them; it
also lists each voucher asked for with what it took off (`vouchers`).
`createOrder` refuses the order. The voucher fields are added to the quote
response only when vouchers were requested, so the consumer app and website —
which call the same `quote()` — receive the response they always have.

What an order used lives in `order_printed_vouchers`: one row per voucher kind
with `quantity` (papers), `discount_amount`, the snapshotted `voucher_name`,
`printed_voucher_id` (ON DELETE SET NULL) and `applied_by`. The report, the
receipt's per-voucher lines and order detail read these rows. On `orders`,
`voucher_discount_amount` is the total of the rows (one of the splits that sum
to `discount_amount`), `voucher_name` a one-line summary ("Any Large Pizza
×3") that also marks "this order used vouchers", `printed_voucher_id` the
voucher when exactly one kind was used, and `voucher_by` who applied them.
Orders placed before vouchers could combine were copied into the table by
migration `…132`, one row each.

## Permissions

`printed-vouchers:view | create | edit | delete` for the admin page and the
report, `printed-vouchers:apply` for the till. The migration grants each to the
roles that already hold the matching `staff-discounts:*` permission (`apply`
also follows `orders:apply-manual-offer`). Brand-locked admins see and manage
only their own brands' vouchers and redemptions.

## Not supported (yet)

- Kiosk carts finalized at the till, and consumer app / web orders.
- A per-customer or per-booklet usage limit, or a cap on papers per order
  beyond the items in the cart.
- Restricting a voucher to one size of an item (every pizza and box currently
  has a single size).
