# Foodie POS — Complete User Guide

> **Version:** 1.0
> **Last Updated:** June 2026
> **Platforms:** Web Browser — Admin Panel · POS · Back Kitchen · Packing · Rider App

*A step-by-step guide for everyday use of your Point-of-Sale system. It is written for the people who use the system every day — cashiers, kitchen staff, packers, delivery riders, and managers. It explains what each screen does and how to get your daily work done. No technical knowledge is needed.*

[[TOC]]

---

## 1. Getting Started

### Logging In

1. Open the system in your web browser.
2. Enter the **email** and **password** given to you by your manager.
3. Click **Login**.

Where you land after login depends on your role:

- **Cashiers, managers, and admins** see the main system with a side menu.
- **Delivery riders** are taken straight to the Rider app.

### Logging Out

Use the **Logout** button (top of the screen) when you finish your shift. Always log out on shared devices.

### A Note on Shifts (Important for Cashiers)

Before any orders can be taken at a branch, a **shift must be open** for that branch. If you try to add items and see the message *"Open a shift in Admin → Shifts before adding items to the order,"* ask your manager to open the shift first. (See Shifts under the Admin Panel.)

---

## 2. Who Does What (Roles)

The system has different screens for different jobs. You'll only see the screens your role is allowed to use.

| Role | Main Screen | What they do |
|---|---|---|
| **Cashier** | POS / Order Taking | Take customer orders, apply discounts, collect payment |
| **Kitchen staff** | Back Kitchen (KDS) | See incoming orders, cook them, mark them ready |
| **Packing staff** | FOH Packing | Pack ready orders and hand them over |
| **Delivery rider** | Rider app | Pick up and deliver orders, update delivery status |
| **Manager / Admin** | Admin Panel | Set up the menu, prices, staff, view reports |

An order naturally flows from one role to the next:

> **Order Flow:** Cashier takes order → Kitchen cooks it → Packing hands it over → Rider delivers it (for delivery orders).

---

## 3. The Cashier / POS Screen — Taking Orders

This is the main screen for taking customer orders. It has three parts:

- **Top bar** — choose the order type, branch, brand, and category; search the menu.
- **Centre** — the menu of items you can tap to add.
- **Right-hand cart** — the customer's order, where you review and check out. On a phone or tablet, tap the **🛒 Cart** button (bottom-right) to open it.

### Step 1 — Choose the Order Type

At the top of the screen, pick how the customer is ordering:

- **Dine In** — eating in (you'll enter a table number).
- **Takeaway** — picking up at the counter.
- **Delivery** — delivered to an address.

> **Warning:** You must choose an order type *before* adding items. Changing the order type after you've started will clear the cart, so pick it first.

### Step 2 — Find Items on the Menu

- **Search box** — type at least two letters of an item's name. A list of suggestions appears; use the arrow keys and **Enter**, or tap a suggestion. *(Tip: press the / key to jump to the search box instantly.)*
- **Brand** and **Category** dropdowns — narrow the menu down (e.g. show only "Drinks").
- Use **Prev / Next** at the bottom of the menu to page through items.

### Step 3 — Add Items to the Cart

**Tap any item card** to add it. Each card shows the name, price, and small badges — *Variants*, *Add-ons*, or *Modifiers* — when the item has choices.

- **Simple items** (no choices) are added straight away. Tap again to increase the quantity.
- **Items with choices** open a **Configure Item** window first.

### Step 4 — Configure an Item (when it has choices)

The **Configure Item** window may show any of these sections:

- **Select Variant** — choose a size or version (e.g. Small / Medium / Large). The price difference is shown, like *Large +800*. One choice is required.
- **Modifiers** — choices like spice level or sauce. Each group tells you how many to pick (e.g. *"choose 1–2"*). Some are required.
- **Add-ons** — optional extras (extra cheese, bacon, etc.). Tick the ones you want; a **Quantity** box appears so you can add more than one.
- **Special Instructions** — a free-text note (e.g. *"No onions, extra spicy"*). This prints for the kitchen.

A **green tick** next to a section means it's complete; an **orange alert** means a required choice is still missing.

When done, click **Add to Order** (or **Cancel** to discard).

### Deals & Combos

Some items are **deals** (e.g. *Burger + Fries + Drink*). Tapping a deal opens a **Configure** window with **slots**:

- **Fixed slots** already have the item chosen. If it can be customised, a **Customize** button appears.
- **Choice slots** let you pick from several options. After choosing, you can **Customize** that pick too.

Fill every slot, then click **Add Deal to Order**.

### Step 5 — Review the Cart

Each line in the cart shows the item, its variant, add-ons, modifiers, notes, quantity, and price. For any line you can:

- **Change quantity** — adjust the **Qty** number.
- **Edit** — reopen the Configure window to change choices.
- **Remove** — click the **×** and confirm *"Remove '[item]' from the order?"*

### Step 6 — Checkout: Customer & Details

Click **Checkout** (or press **Ctrl + Enter**) to open the checkout window. Fill in:

- **Table Number** — required for **Dine In** orders.
- **Customer** — search by name or phone. If they're new, click **+ Add customer** and enter their **Name** and **Phone** (format: 03XXXXXXXXX). If the customer has loyalty points, their balance shows here.
- **Loyalty Points to Redeem** *(optional)* — enter how many points to use as a discount (up to the customer's balance).
- **Delivery Address** — required for **Delivery** orders.
- **Discount Code** *(optional)* — type a promo code. If it doesn't apply you'll see *"Coupon not applied. Check code and branch."*
- **Order Notes** *(optional)* — a note for the whole order.

### Step 7 — Checkout: Payment

The **Payment** section shows the full breakdown: **Subtotal**, any **Discounts**, **Loyalty**, **Tax**, **Delivery fee**, and the **Total**.

Choose how the customer is paying:

- **Cash**
- **Card**
- **Cash + Card** — a split payment. Enter the cash amount and card amount; together they must equal the total.

Click **Create Order** to finish. You'll see a confirmation like *"Order #1023 created."* A **customer invoice** opens, which you can print and hand to the customer.

After the order is created, the cart clears automatically and you're ready for the next customer.

### Common Messages at Checkout

If something's missing, the system tells you clearly — for example:

- *"Select an order type before checkout"*
- *"Please add items to the order"*
- *"Customer phone is required (Pakistani format: 03XXXXXXXXX)"*
- *"Delivery address is required for delivery orders"*
- *"Please enter a table number for dine-in orders"*

Just fix the highlighted field and try again.

---

## 4. The Kitchen Screen (KDS)

The **Back Kitchen** screen shows orders as they come in, so cooks always know what to make next.

### What You See

Each order appears as a card showing:

- Its place in the queue (1, 2, 3…) and the **order number**.
- The **order type** (Dine-in, Takeaway, Delivery) and **table number** if dine-in.
- The time it was placed and the customer's name.
- Every item with its quantity, variant, add-ons, and any **special notes** (highlighted in yellow).

Orders are shown **oldest first**, so the next thing to cook is always at the top.

### Moving an Order Along

Each order moves through these stages. The button always shows the **next** step:

> **Status Flow:** Placed → Accepted → Preparing → Ready

1. **→ Accepted** — you've seen the order and will start it.
2. **→ Preparing** — cooking has begun.
3. **→ Ready** — the food is done.

Once an order is **Ready**, it moves on to the Packing screen — *"completion happens in FOH Packing."*

### Other Controls

- **Print KOT** — prints a paper Kitchen Order Ticket for the order.
- **Filters** — narrow the view by **date range**, **branch**, **brand**, or **status**.
- **Showing completed / Hide completed** — show or hide orders that are already finished.

---

## 5. The Packing Screen (Front-of-House)

The **FOH Packing** screen is for staff who pack up finished orders and hand them to the customer or rider.

- It shows orders the kitchen has marked **Ready** (this is the default view).
- Each card lists all the items, quantities, add-ons, and notes — but **no prices**.
- Check the order is complete and correct, then click **Handed over (Complete)**.

That's it — the order leaves all the queues and counts as completed.

> **Note:** If an order isn't ready yet, you'll see "Mark complete when status is ready." Wait for the kitchen to finish it first.

---

## 6. The Customer Display

The **Customer Display** is a read-only screen you can put on a monitor facing customers. It simply shows order numbers and their status (Placed, Preparing, Ready, etc.) so customers can watch their order's progress. It fills the whole screen automatically and shows no prices or actions.

---

## 7. The Delivery Rider App

Riders get their own simple app focused on deliveries.

### Going On Duty

1. Choose your **branch** from the list.
2. Tap **Check in to start shift** and confirm.
3. Your status turns to **On duty** (green), and the app begins sharing your live location with dispatch so you can be assigned nearby orders.

> **Note:** Your status badge shows *Off duty* (grey), *On duty* (green), or *On break* (amber) at all times.

### Taking a Break

- Tap **Take a break**, confirm, and optionally add a reason (e.g. *lunch*, *fuel*). While on break you stay checked in but won't get new auto-assignments.
- Tap **End break & resume** to go back on duty.

### Checking Out

Tap **Check out** at the end of your shift. This ends the shift and stops location sharing until you check in again.

### Your Deliveries

The **My Deliveries** list shows every order assigned to you, each with the order number, brand, delivery address (📍), time, total, and current status. Tap **View & update** to open one.

### Delivering an Order

The order detail screen shows:

- The **delivery address** and **customer name**.
- The customer's **phone** — tap it to call directly.
- The **pickup location** (your branch).
- The full list of **items** and the **total**.

To update progress, tap **Update delivery status** and choose the new status:

> **Delivery Flow:** Assigned → Picked Up → Delivered

- **Picked Up** — you've collected the order from the restaurant.
- **Delivered** — the customer has received it.
- **Delivery Failed** — if it couldn't be delivered. You **must** enter a reason (e.g. *"Customer not available, wrong address"*).

Tap **Update** to save. Once an order is **Delivered** or **Delivery Failed**, it's closed and can't be changed.

---

## 8. The Admin Panel — Managing Your Business

The Admin Panel is where managers set up and run the business. You'll see only the sections your role allows. Items are grouped in the side menu roughly as follows.

### Dashboard

Your home screen — sales figures, charts, and ratings at a glance.

### Business Structure

- **Brands** — the restaurant brands you operate.
- **Branches** — each physical location. Open a branch to edit its details, contact info, and settings.
- **Users** — staff accounts and their login details.
- **Branch Users** — which staff are assigned to which branch.
- **Roles** — what each type of staff is allowed to see and do.
- **Business Settings** — top-level company settings (visible to senior admins).

### Menu Management

- **Categories** — menu sections (Appetizers, Mains, Drinks…).
- **Menu Items** — the dishes and products you sell.
- **Deals** — combos and bundle offers.
- **Variants** — sizes/versions of an item (Small, Medium, Large).
- **Addons** — optional extras (extra cheese, sauces).
- **Modifiers** — choices like spice level or cooking style.
- **Branch Pricing** — set prices and availability per branch.

### Customers & Promotions

- **Customers** — your customer list and contact details.
- **Discounts** — promo codes and automatic discounts.
- **Loyalty Settings** — how customers earn and spend loyalty points.

### Orders & Delivery

- **Orders** — every order placed; open one to see full details.
- **Deliveries** — track delivery orders and rider assignments.

### Shifts

Open and close the trading shifts for each branch. **A shift must be open before cashiers can take orders.**

### Reports

Sales and performance reports to review how the business is doing.

### Rider HRM (Staff Management for Riders)

- **Rider profiles**, **Attendance & on-duty**, **Breaks**, **Compensation plans**, **Payroll runs**, and **Ops metrics** — everything for managing your delivery team and paying them.

### Inventory (Stock Control)

- **Units of measure**, **Vendors**, **Inventory items**, **On-hand inventory**, **Stock movement ledger**, **Branch transfers**, **Stock adjustment**, and **Record wastage** — track exactly how much stock you have and where it goes.

### Procurement (Buying Stock)

- **Purchase requisitions** → **Purchase orders** → **Goods receipt notes** — the flow for requesting, ordering, and receiving supplies.

---

## 9. Troubleshooting & FAQ

### Common Issues

| Problem | Solution |
|---|---|
| I can't add items to an order | A shift probably isn't open. Ask a manager to open the shift under **Admin → Shifts**, and make sure you've selected an **order type** first. |
| The discount code won't apply | Check the code is spelled correctly and is valid for your branch. The system shows *"Coupon not applied"* when it doesn't match. |
| A split payment won't go through | For **Cash + Card**, the two amounts must add up to exactly the total. Adjust them until the warning disappears. |
| An order isn't showing on Packing | The kitchen must mark it **Ready** first. Until then it stays on the kitchen screen. |
| A rider isn't getting orders | Make sure the rider is **checked in** (On duty, green) and not **On break**, and has allowed location access so dispatch can find them. |

### General Good Habits

- Always **log out** on shared devices.
- Double-check the **customer phone and address** for delivery orders.
- Hand the customer their **invoice** after every order.
- Keep order statuses up to date so the next person in the chain knows what's happening.

---

> **Need Help?** For account setup, new staff, or permission changes, contact your manager or system administrator.

*Powered by Rex Technologies*
