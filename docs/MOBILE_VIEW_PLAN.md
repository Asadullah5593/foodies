# Mobile & tablet view — audit and implementation plan

Date: 2026-10-07 · Scope: `frontend/` (admin panel, POS, KDS, FOH, Rider app, attendance station, login)
Rule: **desktop (≥ 1024 px) rendering must not change.** Everything below is scoped to `< 1024 px`.

## 1. What the audit found

Method: three code sweeps (shell + shared components, Admin pages, POS/KDS/FOH) plus a headless-Chrome
run of 45 routes at 360, 390, 768, 1024 and 1440 px (225 screenshots, layout metrics per page). Script,
metrics and screenshots are kept at `~/.claude/projects/-var-www-html-foodies/mobile-audit-2026-10-07/`.

| Viewport | Pages with horizontal overflow | Cause |
|---|---|---|
| 360 (small phone) | 43 / 45 | header icon row (+71 px), POS header (+99–125 px), customer display header |
| 390 (phone) | 42 / 45 | header icon row (+41 px) on every shell page; POS header (+69–95 px) |
| 768 (tablet portrait) | 0 / 45 | — |
| 1024 (tablet landscape) | 0 / 45 | — (this *is* the desktop layout) |
| 1440 (desktop baseline) | 0 / 45 | — |

Across all viewports 53 % of tap targets are under 40 px (the design uses small buttons everywhere);
8 data tables, only 4 inside a horizontal-scroll wrapper; one console error (`/admin/brands`, a ref
passed to a function component — pre-existing, desktop too).

### What already works
- The shell has a mobile drawer below `lg` (hamburger, overlay, 280 px off-canvas aside).
- POS already switches below `lg` to one column + a cart FAB + bottom sheet.
- Dashboard cards/charts, Order detail, Shifts cards, Orders (card fallback measured by width), Customers
  (sticky actions column), HR tables (scroll wrappers), KDS/FOH ticket grids, Customer Display, Rider
  pages (partly), Attendance station (fully).

### What is broken (ranked by how many screens it affects)
1. **Header** (`App.tsx:817-941`, ~90 routes): six icon buttons + title + user name never wrap → every
   page overflows on phones; not sticky, so the hamburger scrolls away. On POS it also carries "Back to
   Orders", "POS" and the order-type tabs.
2. **`AccentedListRow`** (`components/AccentedListRow.tsx`, 20 admin list pages: Menu Items, Categories,
   Deals, Users, Branches, Variants, Addons, Branch Pricing, Branch Users, Roles, Banners, Promotions,
   Discounts…): no-wrap flex, 3–4 action buttons never wrap, meta column fixed `w-24` → title squeezed to
   one word per line and actions clipped on **both phone and tablet portrait**. Desktop renders fine.
3. **Filter bars**: hand-rolled `flex` rows of `SearchableSelect`s with `min-w-[140-240px]`. On Orders the
   six selects collapse to ~40 px empty boxes; on KDS/FOH the filters fill the first screen.
4. **`SearchableSelect` / `SearchableMultiSelect` / `TypeaheadDropdown` / `CustomerSearchSelect` /
   `AddressAutocomplete`**: absolute, non-portaled dropdowns clipped inside modals/scroll containers,
   overflow the right edge, `autoFocus` pops the phone keyboard over the list.
5. **`Modal`** (59 importers, 91 instances): centred dialog with `100vh` maths (iOS toolbar cuts the
   footer), 24 px close icon, scroll lock that iOS ignores. `OfferModal` fixed `h-[88vh]` + `px-7`.
   `ItemConfigModal` / `DealConfigModal` inline `height: 90vh`, `px-8`, footer doesn't wrap;
   DealConfigModal's fixed `w-[266px]` rail leaves ~77 px for the choices at 375 px.
6. **POS phone**: header overflow; `h-[calc(100vh-4rem)]` assumes a 64 px navbar → double scroll;
   brand tiles and category pills wrap to 8+ rows; only one row of menu items visible; pager hidden
   under the FAB; bottom-sheet body is a plain scroll box so the Total/Checkout footer scrolls away;
   checkout is a modal inside a modal (`max-h-[75vh]` nested scroll); cart ± buttons ~30 px; receipt
   auto-print uses `window.open` without a tap (mobile browsers block it).
7. **Wide ledgers** with fixed min-widths and no card fallback: Product Sales (`min-w-[1206px]`,
   unprefixed `px-9`), Procurement (1000–1100 px), Stock Adjustments (920 px), Inventory/On-hand/Ledger,
   Activity log (`px-9`). Form grids `md:grid-cols-5/6` squeeze on tablets.
8. **Page padding doubled**: `main` is `p-4` and ~45 pages add `px-4 sm:px-6` → 296 px of content on a
   360 px phone.
9. **Unprefixed grids** in modals/forms (`grid-cols-2/3/4` in MenuItems, Discounts, Coupons, Promotions,
   Tenants, Roles, ValidityFields, CustomerVouchersModal), fixed panes (`Campaigns w-[480px]`,
   `InvoiceTemplateFormModal` 216 + 340 px rails, Shifts dialogs 660/720 px), `min-w-[280px]` header
   text blocks (BankCards, PrintedVouchers), `w-[90px]` time inputs.
10. **Notifications**: bell dropdown anchored right-0 but the bell isn't right-most → runs off-screen;
    `OrderNotificationStack` (`top-16 right-4 w-80`) collides with the toaster (`top-right`);
    `ScrollToTopButton` and the POS cart FAB share `bottom-6 right-6`.
11. **Rider app**: no bottom nav, CTA not sticky, live-location badge `hidden lg:flex` (riders never see
    it), status modal hand-rolled, list status pills hidden below `sm`.
12. **Login**: hero first, form below the fold on phones.
13. **Charts**: Recharts heights fixed (280/240) and Y-axis 84–130 px wide eat phone width.

### Infrastructure gaps
- No viewport hook (`useMediaQuery`/`useIsMobile`); width logic is ad hoc (two `ResizeObserver`s).
- No `max-*:` Tailwind variants used anywhere (available in 3.4) — the tool for "mobile only".
- No `dvh`, no `safe-area-inset`, no `viewport-fit=cover`.
- Tests: 95 files, none mock `matchMedia`; several assert exact class strings (`AccentedListRow.meta`
  asserts `w-24`; BrandTiles, OrderTypeNavTabs, Customers.table, CustomerDetail, HoverReveal).

## 2. Principles (how we keep desktop untouched)

1. **Breakpoints**: phone `< 640` (`max-sm:`), tablet portrait `640–1023` (`sm:max-lg:`), desktop
   `≥ 1024` unchanged. Tailwind's `lg` is already the shell's desktop cut-off, so every new rule is a
   `max-lg:` / `max-sm:` variant or lives inside an `if (!isDesktop)` branch. Never edit an unprefixed,
   `sm:` or `md:` class on an existing element — add a `max-lg:` override next to it instead.
2. **One viewport hook** (`useViewport()` → `{ isPhone, isTablet, isDesktop }`) built on `matchMedia`
   with the same 640/1024 thresholds, for structural switches (bottom sheet vs dialog, card list vs
   table, chart sizes). Desktop branch returns the current tree exactly.
3. **Shared components first.** Fixing `AccentedListRow`, `Modal`, `SearchableSelect`, `Button`,
   `PaginationBar`, `OfferModal` fixes most of the ~85 admin pages before touching them individually.
4. **Proof, not promise**: the headless-Chrome script captures 1280 and 1440 px baselines of all 45
   routes before work starts; after every phase it re-captures and pixel-diffs (`pixelmatch`) → zero
   desktop diffs is the merge gate. Mobile viewports are re-captured for review.
5. **Touch rules below `lg`**: 44 px minimum tap targets, no hover-only affordances, dropdowns portaled
   and clamped to the viewport, native keyboard not pre-opened, `100dvh` not `100vh`, safe-area padding.
6. **Dark mode**: `index.css` overrides exact class names (`.dark .bg-white !important`); every new
   mobile surface is checked in dark mode too.
7. **Don't fix desktop bugs in this work** (found but out of scope unless asked): NotificationSettings
   save bar ignores the collapsed sidebar; Modal backdrop click never closes; POS mounts both trees and
   shares `searchInputRef`; `/admin/brands` ref warning; shell drawer's "Collapse" button writes the
   desktop collapsed state (this one *is* mobile-visible and will be hidden on mobile).

## 3. Phases

### Phase 0 — Foundation (no visible change anywhere)
- `src/hooks/useViewport.ts` + `matchMedia` mock in `setupTests.ts` + unit tests.
- `index.html`: `viewport-fit=cover`; Tailwind `safe-area` utilities (padding helpers only).
- `frontend/scripts/visual-audit.cjs` (the audit script, puppeteer-core devDependency, uses the installed
  Chrome; `npm run audit:visual`) and the 1280/1440 baseline capture. *Optional to commit — see
  decision 7.*
- Conventions note in `docs/MOBILE_VIEW_PLAN.md` §2 referenced from `CLAUDE.md` (one line).

### Phase 1 — Shell (fixes the overflow on ~90 routes)
- Header `< lg`: sticky top with safe-area padding; keep hamburger · title · bell; move POS / Orders /
  Attendance / keyboard / theme into a "⋯" menu (or the drawer footer); hide the user name on phones.
  POS header `< lg`: icon-only back button, drop the "POS" label, order-type tabs stay icon-only.
- Drawer: close button, Escape, body scroll lock, close on route change, animated exit, hide the
  desktop "Collapse" button, 44 px nav rows.
- Notification bell → full-width sheet `< sm`; `OrderNotificationStack` + toaster share one top-centre
  column on phones; one bottom-right slot scheme for ScrollToTop / POS FAB / future bottom nav.
- Login `< lg`: compact brand strip, form first.
- `main` padding stays; the per-page double padding is removed in the cluster passes with
  `max-lg:px-0` on the page root.

### Phase 2 — Shared components (fixes clusters A/B and most modals)
- `AccentedListRow` `< lg`: two-row layout (avatar + title/meta full width; status pill visible; actions
  wrap under; `< sm` collapse actions into `RowActionsMenu` "⋯"). Keep `w-24` on desktop (test asserts it).
- `Modal` `< sm`: bottom-sheet presentation (full width, `max-h-[92dvh]`, drag handle, sticky footer
  slot, 44 px close, iOS-safe scroll lock). `sm:max-lg:` centred but `dvh`-based. Desktop branch
  unchanged. `OfferModal`: `max-lg:` full-screen sheet, `max-lg:px-4`, wrapping footer.
- `SearchableSelect`, `SearchableMultiSelect`, `TypeaheadDropdown`, `CustomerSearchSelect`,
  `AddressAutocomplete`: portal + viewport clamp (copy `BrandLockSelect`), `max-lg:w-full max-lg:min-w-0`,
  no `autoFocus` on touch, 44 px options; `< sm` optional sheet picker for long lists (brands, branches).
- `Button`: `max-lg:min-h-[44px]` for `small`/`medium`; `SegToggle`, cart ± and pager targets likewise.
- `PaginationBar` `< sm`: Prev · "1 / 40" · Next, size picker behind a tap.
- `ValidityFields`, `CustomerVouchersModal`, `SizeMapEditor`: `max-sm:grid-cols-1/2`.
- New `FilterBar` helper: wraps a page's filters; `< sm` shows a "Filters (n)" disclosure with active
  chips, full-width controls inside; `≥ lg` renders children untouched.
- Charts (`dashboard/charts.tsx`): via the hook, smaller heights and Y-axis widths `< sm` only.

### Phase 3 — Admin page clusters (verify after Phase 2, then page-specific fixes)
| Cluster | Routes | Work |
|---|---|---|
| A. Card-list CRUD (`AccentedList` + Modal) | ~17 | header rows wrap; unprefixed modal grids → `max-sm:grid-cols-1`; FilterBar |
| B. Offer pages (`OfferModal`) | ~8 | grids; Campaigns `w-[480px]` → stack; InvoiceTemplateFormModal rails → stacked `< lg`; 30 px icon buttons |
| C. Tables in scroll wrappers | ~24 (HR excluded: ~12) | scroll-hint shadow + sticky first column; card view `< sm` for Customers, Activity log, Printed-voucher report, Rider supervisor; wrap the 4 unwrapped tables |
| D. Wide ledgers | ~10 | scroll wrapper + sticky key column; `px-9` → `max-lg:px-0`; form grids `max-lg:grid-cols-2`; Orders already has cards |
| E. Detail pages | 6 | CustomerDetail `minmax(min(100%,300px))`, table wrapper, `min-w-[220px]` |
| F. Settings & forms | ~15 | `min-w-[170px]` selects, Shifts dialogs 660/720 px → `max-lg:w-full`, grid templates, time inputs |
| G. Dashboards | ~6 | breakdown table wrapper, chart sizes, Reports `p-6` → `max-lg:p-4` |

### Phase 4 — POS (phone and tablet portrait)
- Heights `< lg`: `h-[calc(100dvh-<real chrome>)]`; desktop keeps its current calc.
- Phone: brand tiles → one horizontally scrolling snap row; category pills → one scrolling row with the
  active pill kept in view; compact top bar (branch select + search on one row, shift badge on the next);
  menu grid rows derived from available height (not the fixed 3); pager moved above the FAB.
- Bottom sheet: flex column so Total/Checkout stay pinned; handle + title ("Cart · 3 items · Rs 1,200");
  FAB shows count/total.
- Checkout `< sm`: full-screen sheet with sections (Customer · Order type · Discounts/Vouchers · Payment),
  one scroll; `sm:max-lg:` large centred modal.
- `ItemConfigModal` / `DealConfigModal` `< lg`: full-screen sheet, side rail → horizontal chips, wrapping
  footer; `≥ lg` keeps `height: 90vh`.
- Receipt `< lg`: "Print receipt" button (user gesture) instead of auto-open.
- Tablet portrait (`sm:max-lg:`): two panes — menu + 18–20 rem cart — instead of the phone sheet
  (decision 6).

### Phase 5 — KDS, FOH, Customer Display
- FilterBar on KDS/FOH (date range on one row, status/ready/completed as chips); remove double padding.
- Ticket cards `< sm`: full width, 48 px primary status action pinned to the card bottom, Print KOT
  secondary; tablet portrait keeps 2 columns.
- Customer Display header wraps `< sm`.

### Phase 6 — Rider app, attendance, misc
- Rider: bottom nav `< lg`, sticky order CTA, live-location badge visible on phones, status modal → sheet,
  `AccentedListRow` pills visible (comes from Phase 2).
- Attendance station: verify 360 and tablet, safe-area.
- `/admin/brands` ref warning left alone (desktop too).

### Phase 7 — QA and hand-over (per drop)
- Visual audit: `cd frontend && AUDIT_OWNER_EMAIL=… AUDIT_OWNER_PASSWORD=… AUDIT_CASHIER_EMAIL=… AUDIT_CASHIER_PASSWORD=… npm run audit:visual -- --out .visual-audit/baseline --ids order=…,customer=…,branch=…,role=…` before the change (from the branch base), then the same with `--out .visual-audit/after --clock $(cat .visual-audit/baseline/clock.txt)` after it, then `npm run audit:diff -- --base .visual-audit/baseline --after .visual-audit/after --viewports desktop-1280,desktop-1440,tablet-l-1024`. Zero changed pages is the gate; `/login` moves (floating decorations) and live-data pages may show noise — open the diff PNG before concluding. Known capture noise on an otherwise identical build: `/login` (animated decorations), recharts bar bodies on the dashboard, and the scroll-to-top button appearing in one capture only — the axes, labels and everything else must match.
- Re-run the visual audit at 360 / 390 / 768 / 1024 / 1280 / 1440; pixel-diff 1280 + 1440 against the
  baseline → must be zero; review mobile shots in light and dark mode.
- Vitest: new hook/component tests; update the class-asserting tests only where a `max-lg:` class is
  appended (assertions on desktop classes stay true).
- `npm run lint`, `npm run build`, trial-merge into `origin/staging` (Login.tsx and Admin/Notifications
  differ there — expect to resolve).
- Real device check by the owner: `vite --host` on the LAN, or on staging after merge.

## 4. Delivery (git rule)

Per the standing rule: a new branch cut from `origin/main` in a scratchpad worktree, commits as Asad
Ullah, trial-merge into staging, then exactly two compare links (main and staging). Employee HRM never
reaches main.

Recommended: **three drops**, each its own branch + two PRs, merged in order (each later drop is cut
from main after the previous one merges, or from the pending branch if it hasn't):

| Drop | Branch | Content | Rough size |
|---|---|---|---|
| 1 | `feat/mobile-shell-and-components` | Phases 0–2 | ~25 files, 2–3 sessions |
| 2 | `feat/mobile-admin-pages` | Phase 3 (+ Rider HRM pages, which are on main) | ~60 files, 3–4 sessions |
| 3 | `feat/mobile-pos-kds-rider` | Phases 4–6 | ~30 files, 3 sessions |

Drop 1 alone removes the overflow on every page and fixes the list rows, so it is worth shipping to
staging early for the owner to try on a phone.

**Employee HRM (51 `Admin/HR` files + attendance station) exists only on staging.** Its mobile pass
cannot be in a main-bound branch. Options: skip it, or do it afterwards as a staging-only branch and PR
(see decision 3). Shared-component fixes from Drop 1 will already improve those pages once merged to
staging.

## 5. Decisions (agreed 2026-10-07 — owner went with the recommendations)

1. **Scope** — `frontend/` only; `consumer-web/` (Next.js customer site, already responsive) untouched.
2. **Desktop cut-off stays at 1024 px** — iPad landscape (1024) keeps the desktop layout with the
   collapsible sidebar.
3. **Employee HRM pages** (staging-only) — later, as a staging-only branch, after Drop 2.
4. **Three drops**, each one branch + two PR links.
5. **44 px touch targets below `lg`**; desktop density unchanged.
6. **POS on tablet portrait (768–1023)** — two panes with a narrower cart.
7. **Commit the visual-audit script** (`frontend/scripts/visual-audit.cjs`, puppeteer-core devDependency,
   no browser download) so the desktop zero-diff gate is reproducible.
8. **Desktop bugs found** — left untouched in this work (listed in §6).

## 6. Parked — not in this work, kept for a later debate

Each item says why it is parked and what it would take, so it can be picked up without re-auditing.

| # | Item | Why parked | What it would take |
|---|---|---|---|
| P1 | **Employee HRM mobile pass** (51 `Admin/HR` files + attendance station) | staging-only code; a main-bound branch cannot carry it | a staging-only branch + 1 PR after Drop 2; Drop 1's shared fixes already improve it |
| P2 | **iPad landscape (1024–1279) as tablet** | 1024 is the desktop cut-off; changing it alters small laptops | move the shell's `lg` to `xl` (or add a custom `desk` screen) and re-baseline; ~700 px of content at 1024 with the sidebar open today |
| P3 | **`consumer-web/` mobile review** | customer site, Next.js, already responsive (26/51 files use breakpoints) | a 1-session audit with the same screenshot script pointed at port 3002 |
| P4 | **NotificationSettings fixed save bar** `lg:left-[280px]` ignores the 72 px collapsed sidebar | desktop bug | read the collapsed state and switch the offset; desktop pixel change |
| P5 | **Modal backdrop click never closes** (z-50 wrapper covers the z-40 backdrop) | desktop behaviour change | one z-index/handler fix in `components/Modal.tsx`; decide whether backdrop-close is wanted at all |
| P6 | **POS mounts both layout trees** and shares `searchInputRef`, so "/" can focus a hidden input on desktop | desktop refactor risk | render one tree from `useViewport()`; re-test the POS keyboard shortcuts |
| P7 | **`/admin/brands` console warning** (ref passed to a function component) | harmless, desktop too | `forwardRef` on the offending component |
| P8 | **Held / parked orders on POS** and **shift open/close from the POS screen** | features, not layout; POS links to `/admin/shifts` today | product decision first |
| P9 | **On-screen keyboard vs native keyboard on phones** (`OnScreenKeyboardContext`, `fixed bottom-0 z-[100]`) | off by default; only matters if a phone user turns it on | hide the toggle below `lg` or disable the feature on touch devices |
| P10 | **Reorder drag-and-drop on touch** (`ReorderModal`, dnd-kit `PointerSensor`, no `touch-action`) | admin-only, rarely done from a phone | add `TouchSensor` + `touch-action: none` on handles |
| P11 | **Dark-mode `!important` overrides** in `index.css` restyle any new `max-lg:` surfaces | works today, fragile | migrate the overrides to Tailwind `dark:` classes page by page |
| P12 | **Recharts fixed heights on desktop** (280/240, Y-axis 84–130 px) | desktop look | only the `< sm` sizes change in this work |
