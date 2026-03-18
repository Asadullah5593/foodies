# POS Screen Revamp — Design Spec

## Wireframes

- **Desktop layout:** `assets/pos-wireframe-desktop.png` — 3-pane layout (left filters, center menu grid, right checkout).
- **Tablet layout:** `assets/pos-wireframe-tablet.png` — Top bar + full-width menu; bottom sheet for cart/checkout.

## Foodies Color Tokens

Based on the Foodies logo (black circle, white script, red inner ring):

| Token | Light theme | Dark theme |
|-------|-------------|------------|
| Primary (accent) | `#B91C1C` (red-700) / amber for CTAs if preferred | Same red for accents |
| Surface | `#FFFFFF` | `#1F2937` (gray-800) |
| Surface muted | `#F8FAFC` (slate-50) | `#111827` (gray-900) |
| Text primary | `#0F172A` (slate-900) | `#F8FAFC` |
| Text secondary | `#64748B` (slate-500) | `#94A3B8` |
| Border | `#E2E8F0` (slate-200) | `#374151` (gray-700) |

Optional: preserve existing amber for "Create Order" and highlights; use red for brand header/logo area.

## Component Breakdown

| Component | Responsibility | Props / data |
|-----------|----------------|--------------|
| **POSLayout** | Responsive shell; desktop 3-pane or tablet + drawer | children, drawerOpen, onDrawerToggle |
| **POSFilters** | Branch, order type, brand, category, search | branchId, setBranchId, orderType, setOrderType, brands, selectedBrandId, setSelectedBrandId, categories, selectedCategoryId, setSelectedCategoryId, search, setSearch, openShift, posBranches |
| **MenuGrid** | Menu item cards; quick add / open config modal | menu, addItem, justAddedItem, getBrandName |
| **CartPanel** | Line items list, quantity edit, remove; optional collapsible | selectedItems, updateQuantity, removeItem, quote, total, getBrandName |
| **CustomerPanel** | Customer search, add customer; table/delivery fields | orderType, tableNumber, setTableNumber, customerName, customerPhone, setCustomerName, setPhone, deliveryAddress, setDeliveryAddress, loyaltyBalance, loyaltyPointsToRedeem, setLoyaltyPointsToRedeem, discountCode, setDiscountCode, orderNotes, setOrderNotes, quote, phoneError, onAddCustomerClick |
| **PaymentPanel** | Payment mode, multipay inputs, Create Order button | paymentMode, setPaymentMode, paymentCashAmount, paymentCardAmount, setPaymentCashAmount, setPaymentCardAmount, quote, total, onCreateOrder, isSubmitting, lastOrderGroupId, onViewInvoice |
| **ItemConfigModal** | Variant/addons/modifiers for one item; confirm add | open, item, config, setConfig, onConfirm, onClose |

All state remains in the parent page (OrderTaking) so behavior is unchanged; components are presentational + callbacks.

## Interaction Notes

- **Collapsible sections (right panel):** Customer, Cart, Discounts & loyalty, Payment. Default: all open. State key: `pos-panel-collapse` in localStorage (e.g. `{ customer: false, cart: true, discounts: true, payment: true }`).
- **Quick add:** Single tap on menu card = add 1 (or open config if item has variants/addons/modifiers). Long-press or "Customize" = open config modal.
- **Animations:** List add/remove (framer-motion AnimatePresence); panel expand/collapse (height/opacity); menu card hover/tap (existing whileHover/whileTap).
- **Keyboard shortcuts (desktop):** `/` focus search; `Enter` add first filtered item (if any); `Ctrl+Enter` create order; `Esc` close modals/drawer.
- **Touch:** Bottom sheet for checkout on narrow viewport; swipe handle to expand/collapse. Large tap targets (min 44px).

## Implementation Order

1. Refactor into components (no layout/theme change).
2. Add Foodies theme tokens and apply to POS only.
3. Implement new layout (3-pane desktop; drawer tablet).
4. Add collapsible panels + keyboard shortcuts + animation polish.
5. QA all flows (branch, brand, category, search, item config, discounts, loyalty, payments, create order).
