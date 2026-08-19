# Employee HRM — specification of record

Status: **Complete — Phases 1–7 built (backend + admin UI) on `feat/employee-hrm`.** Decisions here were agreed with the client on 2026-08-12. Anything not written down here is undecided; anything written down here is the reference implementation must match.

Scope: employee master data, attendance capture without biometrics, leaves and holidays, overtime, payroll, employment history, reviews and promotion, training, and exit. Rider *dispatch* and rider *sharing* are out of scope; rider *pay* is in scope and converges into this module (see [Rider convergence](#12-rider-convergence)).

---

## 1. Vocabulary — read this before anything else

This codebase already uses two of these words for something else. Using them loosely will make the module unreadable.

| Term | Means | Do NOT confuse with |
|---|---|---|
| **shift** | An existing POS **till session** with cash reconciliation (`shifts` table) | Anything in this document |
| **work schedule** | When an employee is *rostered* to work (`work_schedule_templates`, `employee_schedules`) | `shifts` |
| **attendance** | What actually happened (`attendance_punches`, `attendance_days`) | `rider_attendance_sessions`, which stays dispatch-only |
| **role** | An existing RBAC **permission set** (`roles` table) | Job title |
| **designation** | HR **job title / grade** (`designations`) — exists even for staff with no login | `roles` |
| **employee** | An HR record. May or may not have a `users` row | `users`, `branch_users` |

**Employees and users are separate.** A cashier exists twice: as a `user` (can log in) and as an `employee` (has salary, attendance, reviews). The link is `employees.user_id`, nullable and unique. Most employees — cooks, cleaners, porters, security — will never have a `users` row.

---

## 2. Locked decisions

| # | Area | Decision |
|---|---|---|
| 1 | Rider pay | One payroll engine. Rider facts supplied by a pluggable fact-provider. `rider_comp_plans` migrated in Phase 4; `rider_payroll_*` frozen read-only for history |
| 2 | Capture | **Employee code + PIN on the POS.** Photo, QR card and manager attestation configurable per tenant/branch. **No phone OTP. No employee self-service.** |
| 3 | Midnight | Branches do trade past midnight. The work-date rule in §5 is built and tested, not dormant |
| 4 | Daily rate | `basic ÷ 30`, stored as a configurable enum |
| 5 | Rider attendance | Riders punch on the POS like everyone else. POS punch is authoritative for pay |
| 6 | HR admin | Seed a dedicated `hr_manager` role |
| 7 | Salary visibility | `salary:view` — Owner / GM / HR only. Branch Managers see attendance, leaves, waivers, reviews, but no figures |
| 8 | Late rule | 15 min grace (configurable). 1st late free, 2nd = ½ day, 3rd = full day. Ladder restarts every 3 lates. Counter resets each payroll period |
| 9 | Deduction override | Admin + HR Manager may waive any deduction or add one, with mandatory reason logging |
| 10 | Monthly offs | 4/month, paid, no carry-forward, unused offs **encashed at `basic ÷ 30`** |
| 11 | Overtime | Accrues as *pending*; a manager confirms it before payroll locks. Approved or rejected from the attendance register — per day, or all at once for the filtered range |
| 12 | Payroll cycle | Configurable; default calendar month |
| 13 | Payslip | Manager downloads / prints a PDF at the branch |
| 14 | Exit | Record + clearance in Phase 1; settlement arithmetic lands with payroll in Phase 4 |
| 15 | Brand scope | One brand per assignment, **nullable** for shared staff. Transfers create new assignment rows |
| 16 | Training | Missing training on promotion = **warning**, never a hard block |
| 17 | Approvals | `hr_approval_rules` — configurable thresholds, permission-gated |
| 18 | Reviews | Scheduled cycles anchored to joining date. Ad-hoc reviews fully independent, identical consequences |
| 19 | Data | Fresh start. No historical migration |
| 20 | Nav | New **top-level "HR"** admin section. Rider HRM stays separate until Phase 4 folds rider pay in |
| 21 | Backfill | Generate employee records from existing `branch_users` logins, with a placeholder joining date HR must correct. Guarantees the user↔employee link is right; nobody is paid off it until HR completes the data |
| 22 | Terminals | **No terminal registry.** Punches bind to the branch; burst detection groups by `pos_user_id` instead of device |
| 23 | Media | S3 + CloudFront confirmed live in production, so punch photos use the existing media pipeline |

---

## 3. Data model

All tables are tenant-scoped unless noted. DB naming is snake_case; entity properties camelCase (house convention). Every schema change is a timestamped migration — `synchronize` stays false.

### 3.1 Employee master and history spine

**`employees`**
`id, tenant_id, employee_code (unique per tenant), full_name, father_name, cnic (unique per tenant), date_of_birth, gender, phone, address, emergency_contact_name, emergency_contact_phone, photo_url, user_id (nullable, unique), primary_branch_id, employment_type, date_of_joining, probation_end_date, confirmation_date, status, date_of_leaving, leaving_reason, rehire_eligible, bank_name, account_title, account_number_iban, payment_method, pin_hash, pin_set_at, pin_failed_attempts, pin_locked_until, qr_token, qr_token_issued_at, metadata jsonb, created_at, updated_at`

`status` ∈ `active | on_leave | suspended | notice_period | resigned | terminated`
`employment_type` ∈ `full_time | part_time | contract | probation`
`payment_method` ∈ `cash | bank_transfer`

**`designations`** — `id, tenant_id, name, slug, level (int, promotion ladder), department, default_role_id (nullable → roles), is_active`

`department` ∈ `kitchen | front_of_house | delivery | management | support`

**`employee_assignments`** — ⭐ the history spine
`id, tenant_id, employee_id, branch_id, brand_id (nullable), designation_id, employment_type, effective_from (date), effective_to (date, nullable), change_reason, source_review_id (nullable), note, created_by, created_at`

Current assignment = the row with `effective_to IS NULL`. Exactly one per employee, enforced by a partial unique index.
`change_reason` ∈ `hire | confirmation | promotion | demotion | transfer_branch | transfer_brand | designation_change | rehire | exit`

This single table answers *previous roles, current role, transfers between branches, transfers between brands* with no special-casing. **Never update an assignment to reflect a change** — close it and open a new one.

**`employee_salary_structures`** — `id, tenant_id, employee_id, effective_from, effective_to (nullable), pay_type, basic_amount, currency (default PKR), daily_rate_basis, per_delivered_order_amount (nullable, riders), change_reason, source_review_id (nullable), approved_by, approved_at, created_by`

`pay_type` ∈ `monthly | daily | hourly`
`daily_rate_basis` ∈ `fixed_30 | days_in_month | working_days` — **default `fixed_30`**

**`employee_salary_components`** — `id, structure_id, component_key, name, kind, calc_type, amount, is_taxable, sort_order`

`kind` ∈ `earning | deduction`; `calc_type` ∈ `flat | percent_of_basic`. Perks and allowances (fuel, mobile, meal, accommodation) live here.

**`employee_documents`** — `id, tenant_id, employee_id, doc_type, file_url, document_number, issued_on, expires_on, verified_by, verified_at, note`

Expiry drives notifications. Relevant in food service: food-handler certificates, medical fitness.

**`employee_events`** — ⭐ the unified timeline
`id, tenant_id, employee_id, event_type, event_date, title, description, ref_table, ref_id, payload jsonb, created_by, created_at`

Every module writes here. This is the single query behind the "complete history in one place" screen. Append-only — events are never edited or deleted.

`event_type` ∈ `hired | confirmed | promoted | demoted | transferred_branch | transferred_brand | designation_changed | salary_changed | perk_added | perk_removed | training_assigned | training_completed | training_expired | review_scheduled | review_completed | warning_issued | leave_approved | suspended | reinstated | resigned | terminated | rehired | document_expiring`

**`employee_warnings`** — `id, tenant_id, employee_id, warning_type, severity, issued_by, issued_on, reason, employee_response, document_url` — feeds reviews.

### 3.2 Scheduling

**`work_schedule_templates`** — `id, tenant_id, branch_id (nullable), designation_id (nullable), name, start_time, end_time, crosses_midnight (bool), break_minutes, grace_minutes, half_day_after_late_minutes, min_minutes_full_day, min_minutes_half_day, overtime_after_minutes, weekly_off_days (int[]), attribution_lead_hours, attribution_trail_hours, is_active`

**`employee_schedules`** (roster) — `id, tenant_id, employee_id, branch_id, work_date, template_id (nullable), planned_start, planned_end, is_weekly_off, is_holiday, is_published, created_by`

Optional per date. Built now, used later — see §5.1.

### 3.3 Attendance

**`attendance_punches`** — raw, immutable
`id, tenant_id, employee_id, branch_id, punch_type, punched_at (server time, UTC), source, method, pos_user_id (nullable), photo_url (nullable), latitude, longitude, is_manual, created_by (nullable), note, created_at`

`punch_type` ∈ `in | out | break_start | break_end`
`source` ∈ `pos | manager_attestation | admin_manual | rider_app`
`method` ∈ `pin | qr_card | manager | admin`

Punches are **never edited or deleted.** Corrections are `attendance_exceptions` rows that change the derived day, leaving the original punch intact.

**`attendance_days`** — ⭐ the derived row payroll reads
`id, tenant_id, employee_id, branch_id, work_date (date, branch-local), schedule_id (nullable), planned_start_at, planned_end_at, first_in_at, last_out_at, worked_minutes, break_minutes, late_minutes, early_leave_minutes, overtime_minutes_pending, overtime_minutes_approved, status, leave_request_id (nullable), exception_flags jsonb, is_locked (bool), computed_at`

`status` ∈ `present | half_day | absent | leave_paid | leave_unpaid | weekly_off | holiday`

Unique on `(employee_id, work_date)`. Recomputed idempotently — see §6.

**`attendance_exceptions`** — corrections *and* leniency, one audit trail
`id, tenant_id, attendance_day_id, kind, subject, old_value jsonb, new_value jsonb, minutes_waived (nullable), amount_waived (nullable), reason (required), requested_by, approved_by, approved_at, status, created_at`

`kind` ∈ `adjustment | waiver | overtime_approval`
`subject` ∈ `missed_punch | wrong_time | status_override | late | half_day | absent | early_leave | overtime`
`status` ∈ `pending | approved | rejected`

Append-only. A rejected or superseded exception stays in the table.

**`attendance_capture_policies`** — `id, tenant_id, branch_id (nullable), primary_method, require_photo (bool), allow_manager_attestation (bool), duplicate_window_seconds, photo_retention_days, is_active`

`primary_method` ∈ `pin | qr_card` (phone OTP deliberately excluded from v1; the enum leaves room).

> **No terminal registry.** Punches bind to the **branch** only (decision #22). A `pos_terminals` table was specced and then dropped: it would have required a rollout step (naming every till) for a signal that `pos_user_id` largely already carries. Burst detection moves from per-device to **per (branch, pos_user_id)**, which is arguably the better grouping anyway — "this cashier's session recorded 11 punches in 90 seconds" is the finding worth acting on, not "this tablet did".

### 3.4 Leaves, offs and holidays

**`leave_types`** — `id, tenant_id, name, code, is_paid, accrual_mode, quota_per_period, carry_forward, max_consecutive_days, requires_document, is_active`

**`leave_balances`** — `id, tenant_id, employee_id, leave_type_id, period_year, period_month (nullable), entitled, accrued, used, carried_forward, adjusted`

**`leave_requests`** — `id, tenant_id, employee_id, leave_type_id, from_date, to_date, first_day_part, last_day_part, total_days (decimal), reason, attachment_url, status, requested_by, approved_by, approved_at, rejection_reason`

`status` ∈ `pending | approved | rejected | cancelled`. On approval the request **writes into `attendance_days`** for the covered range. Leave is not a parallel universe from attendance.

**`holiday_policies`** — `id, tenant_id, branch_id (nullable), designation_id (nullable), offs_per_month (default 4), offs_are_paid (default true), carry_forward (default false), encash_unused (default true), encashment_rate_basis (default `daily_rate`), off_selection (default `floating`), beyond_quota_treatment (default `unpaid_leave`), effective_from, effective_to`

**`public_holidays`** — `id, tenant_id, branch_id (nullable), holiday_date, name, is_paid`

Distinct from monthly offs. Eid, 14 August, etc.

### 3.5 Rules engines

Both are declarative and effective-dated so a payroll run can be recomputed and, more importantly, *explained*.

**`deduction_rules`** — `id, tenant_id, branch_id (nullable), designation_id (nullable), trigger, condition jsonb, effect_type, effect_value, priority, effective_from, effective_to, is_active`

`trigger` ∈ `late | absent | early_leave | missed_punch | unapproved_leave`
`effect_type` ∈ `deduct_days | deduct_amount | deduct_percent_of_daily | mark_half_day | mark_absent`

**`overtime_policies`** — `id, tenant_id, branch_id (nullable), designation_id (nullable), is_enabled, min_minutes_to_qualify, rounding_minutes, rate_type, rate_value, weekly_off_multiplier, holiday_multiplier, daily_cap_minutes, monthly_cap_minutes, requires_approval (default true), effective_from, effective_to`

`rate_type` ∈ `multiplier_of_hourly | flat_per_hour`

**Resolution order for both, most specific wins:** `designation + branch → branch → designation → tenant default`. Same pattern as `branch_menu_items` overriding `menu_items`.

**`hr_approval_rules`** — `id, tenant_id, branch_id (nullable), subject, condition jsonb, required_permission, escalate_to_permission, priority, is_active`

`subject` ∈ `attendance_waiver | leave_request | overtime | payroll_run | salary_change | promotion | payroll_adjustment`

So "a Branch Manager may waive up to PKR 2,000 per employee per month; above that needs GM sign-off" is a row, not a code change.

**Both tables shipped in Phase 7.** `deduction_rules` is seeded per tenant with rows that reproduce the shipped arithmetic exactly (verified against the database: the seeded rows resolve to the same config as the hard-coded constants), and the engine falls back to those constants when a tenant has no rows — so an empty table is not a disabled one. Payroll reads `deduct_days` effects; `deduct_amount` and `deduct_percent_of_daily` are stored but not yet applied, and the settings screen says so rather than pretending. `hr_approval_rules` ships EMPTY: a rule only ever ADDS a requirement on top of the endpoint's own `@RequirePermission`, so no rules means the behaviour the module has always had. Enforced in seven places: waiver approval, overtime confirmation, leave approval, payroll run approval, payslip adjustment, salary change and promotion approval.

### 3.6 Payroll

**`payroll_runs`** — `id, tenant_id, branch_id (nullable), period_from, period_to, cycle_type, status, rule_snapshot jsonb, requested_by, computed_at, approved_by, approved_at, paid_at, reversed_by, reversed_at, reversal_reason`

**`payroll_lines`** — `id, run_id, employee_id, designation_id (snapshot), salary_structure_id (snapshot), present_days, half_days, paid_leave_days, unpaid_leave_days, absent_days, weekly_off_days, holiday_days, encashed_off_days, worked_minutes, overtime_minutes, late_count, gross_earnings, total_deductions, net_payable, currency, payment_status, payment_reference, note`

**`payroll_line_items`** — `id, payroll_line_id, component_key, component_name, kind, quantity, rate, amount, calc_meta jsonb, sort_order`

`kind` ∈ `earning | deduction | waiver | adjustment`

`calc_meta` carries the arithmetic in plain terms — e.g. `{"lates": 3, "ladder_position": 3, "days_deducted": 1.0, "daily_rate": 1666.67}`. Same explainability pattern as the existing `rider_payroll_line_items.formulaMeta`. This is what ends the monthly "why is my salary short" argument.

**`payroll_adjustments`** — ⭐ the manual override, per decision #9
`id, tenant_id, payroll_line_id, direction, target_component_key (nullable), amount, reason (required, non-empty), created_by, created_at`

`direction` ∈ `waive | add_deduction | add_earning`

Immutable. **Never edits a computed figure** — the machine's number stays visible on the payslip next to the human's override, with the actor and the reason. Gated by `payroll:adjust`, which only Admin and HR Manager hold.

**`employee_loans_advances`** — `id, tenant_id, employee_id, principal_amount, installment_amount, installments_total, installments_paid, outstanding_amount, status, approved_by, disbursed_on, note` — auto-deducted per run.

### 3.7 Reviews, promotion, training

**`review_cycles`** — `id, tenant_id, employee_id, sequence_no, cycle_type, origin, ad_hoc_reason (nullable), period_from, period_to, due_date, reviewer_user_id, template_id, status, created_by`

`cycle_type` ∈ `probation_3m | quarterly | ad_hoc`
`origin` ∈ `system | manual` — ⭐ **the scheduler only ever reads `origin = 'system'`.** See §13.
`status` ∈ `scheduled | in_progress | submitted | approved | closed | skipped`

**`review_templates`** — `id, tenant_id, name, applies_to_cycle_types (text[]), schema jsonb, is_active` — config-driven form, same approach as invoice templates. Changing the form needs no migration.

**`employee_reviews`** — `id, tenant_id, cycle_id, employee_id, reviewer_user_id, template_snapshot jsonb, answers jsonb, total_score, max_score, normalized_percent, strengths, improvements, reviewer_comments, employee_comments, acknowledged_at, outcome, promoted_to_designation_id (nullable), new_basic_amount (nullable), effective_from (nullable), training_gaps jsonb, status, submitted_at, approved_by, approved_at`

`outcome` ∈ `promoted | no_promotion | increment_only | pip | terminate`

**`training_programs`** — `id, tenant_id, name, code, category, level, duration_hours, validity_months (nullable), is_mandatory, prerequisite_program_ids (int[]), material_urls jsonb, is_active`

**`employee_trainings`** — `id, tenant_id, employee_id, program_id, status, assigned_on, started_on, completed_on, expires_on, score, certificate_url, verified_by, note`

`status` ∈ `assigned | in_progress | completed | failed | expired`

**`designation_training_requirements`** — `id, tenant_id, designation_id, program_id, required_for, min_score`

`required_for` ∈ `promotion_into | holding_role`

### 3.8 Exit

**`employee_exits`** — `id, tenant_id, employee_id, exit_type, initiated_by, initiated_on, notice_period_days, last_working_date, reason, exit_interview_notes, rehire_eligible, clearance_status, settlement_payroll_line_id (nullable), settled_at`

`exit_type` ∈ `resignation | termination | end_of_contract | abandonment`
`clearance_status` ∈ `pending | in_progress | cleared | withheld`

**`employee_clearance_items`** — `id, exit_id, item_type, description, responsible_role, status, cleared_by, cleared_at, note`

`item_type` ∈ `uniform | keys | pos_access | cash_handover | equipment | outstanding_advance | other`

### 3.9 Audit

**`hr_audit_log`** — `id, tenant_id, actor_user_id, action, entity_table, entity_id, before jsonb, after jsonb, ip_address, created_at`

This system has no application-wide audit log today. Payroll is legally sensitive and immutable after approval, so HR gets a scoped one. Covers: salary changes, payroll adjustments, waiver approvals, PIN resets, attendance overrides, exit records.

---

## 4. Timezone

- `branches.timezone` **already exists and is already correct** — every live branch is `Asia/Karachi`, and the admin UI defaults new branches to it. No new column, and no backfill needed. It is not an HRM-only field: it already gates time-restricted menu items, lunch deals and bank-card offer windows, so it is well-established.
- The residual risk is narrow: the **column default is still `'UTC'`**, so a branch created outside the admin UI (seed, direct SQL) gets UTC silently. Phase 2 must therefore **validate rather than assume** — a branch whose timezone is `UTC` while attendance is enabled is surfaced as a settings warning, not quietly computed five hours out. Do not blanket-change the column default: this is a multi-tenant platform and `UTC` is the defensible neutral default for a tenant outside Pakistan.
- Timestamps remain **naive UTC in the database and correct `...Z` on the API**, exactly like the rest of the system. Nothing about the existing convention changes.
- All attendance *arithmetic* — work-date attribution, lateness, day boundaries, payroll periods — happens in **branch-local time**, converted at the edge.
- Use IANA timezone arithmetic, never a fixed `+05:00` offset. Pakistan has no DST today; a fixed offset would silently break the day someone opens a branch where it exists.
- **Client clocks are never trusted.** `punched_at` is stamped by the server.

---

## 5. The work-date rule

The single most likely source of "the system says I was absent" bugs. Specified with worked examples so it can be tested directly.

### 5.1 Schedule resolution

For an employee and a local date, the schedule is resolved by falling back:

1. `employee_schedules` row for that date (roster) — built now, unused at launch
2. the employee's default `work_schedule_template`
3. the branch's default template

Everyone works fixed timings today, so (2) is the live path. The roster tables and the resolution chain are built anyway: adding rotation later must not require touching the attendance engine.

### 5.2 Attribution

Each resolved schedule produces an **occurrence** with a local `planned_start` and `planned_end` (if `crosses_midnight`, `planned_end` falls on the next calendar date).

Each occurrence has an attribution window:

```
[ planned_start − attribution_lead_hours , planned_end + attribution_trail_hours ]
```

Defaults: `lead = 6h`, `trail = 6h`.

- A punch is attributed to the occurrence whose window contains it.
- If two windows overlap, the occurrence with the **nearest `planned_start`** wins.
- If no window contains it, the punch is stored with `exception_flags.orphan = true` and surfaced in the exceptions report. It is never silently dropped.

> **`work_date` = the local calendar date on which the attributed occurrence STARTS.**

### 5.3 Worked examples

Branch timezone `Asia/Karachi`. Schedule: **17:00 → 02:00**, `crosses_midnight = true`, grace 15 min.

| # | Event | Local time | Attributed to | `work_date` | Result |
|---|---|---|---|---|---|
| 1 | Punch in | Mon 16:52 | Mon occurrence (within lead window) | **Mon** | On time |
| 2 | Punch out | Tue 02:14 | Mon occurrence (within trail window) | **Mon** | One day, 9h22m worked |
| 3 | Punch in | Mon 17:12 | Mon occurrence | **Mon** | Within grace → not late |
| 4 | Punch in | Mon 17:41 | Mon occurrence | **Mon** | `late_minutes = 26` |
| 5 | Punch out | Tue 09:30 | Mon occurrence trail ends 08:00 → **orphan** | — | Flagged `missing_out` on Mon + orphan punch |
| 6 | No punches at all | Mon | — | **Mon** | `absent` |

The naive implementation — `work_date = DATE(punched_at)` — gets example 2 wrong, splitting one night into two attendance days: Monday shows a missing clock-out and Tuesday shows a phantom 2am arrival. Both then cascade into deductions. The rule above exists specifically to prevent that.

---

## 6. Computing `attendance_days`

A pure, idempotent recompute for one `(employee, work_date)`. Re-running it must always produce the same row.

**Triggered by:** any punch, a leave approval or cancellation, an approved `attendance_exception`, a roster change, a policy change, or an admin recompute. Refuses to run when `is_locked = true`.

**Steps**

1. Resolve the occurrence (§5.1). If none and the date is a weekly off → `weekly_off`. If it matches `public_holidays` → `holiday`.
2. If an approved `leave_request` covers the date → `leave_paid` or `leave_unpaid` by leave type; stop.
3. Gather attributed punches, ordered. Derive `first_in_at`, `last_out_at`, paired break intervals.
4. `worked_minutes = (last_out − first_in) − break_minutes`. Missing `out` → flag `missing_out`, `worked_minutes = 0`, and require an adjustment.
5. `late_minutes = max(0, first_in − (planned_start + grace_minutes))`
6. `early_leave_minutes = max(0, planned_end − last_out)`
7. `overtime_minutes_pending = max(0, worked_minutes − scheduled_minutes)` when it clears `min_minutes_to_qualify`, rounded, capped. `overtime_minutes_approved` stays 0 until a manager confirms (decision #11).
8. Status, evaluated in this order:
   - `late_minutes > half_day_after_late_minutes` → **`half_day`**, regardless of hours worked (see §7.2.1)
   - `worked_minutes >= min_minutes_full_day` → `present`
   - `worked_minutes >= min_minutes_half_day` → `half_day`
   - otherwise → `absent`

   The severe-late check comes **first and is not overridable by working longer.** A day may still fall through to `absent` on hours worked; the late check can only make a day worse, never better.
9. Apply approved `attendance_exceptions` of kind `adjustment` (overriding times or status), then recompute 4–8.
10. Apply approved `waiver` exceptions — these do **not** change the attendance figures. They are carried into payroll, so the payslip shows both the deduction and its waiver.

Defaults: `min_minutes_full_day = scheduled_minutes − 60`, `min_minutes_half_day = 50% of scheduled_minutes`.

---

## 7. Deduction rules — test-ready specification

### 7.1 Daily rate

```
daily_rate = basic_amount / 30          # daily_rate_basis = fixed_30 (default)
           = basic_amount / days_in_month
           = basic_amount / working_days_in_period
```

The same `daily_rate` is used for **both deductions and off-day encashment** (decision #10). One rate, so an employee can check the arithmetic themselves.

### 7.2 Lateness

A day is late when `late_minutes > 0`, i.e. arrival is later than `planned_start + 15 min` (grace configurable per template).

Lates are counted **per employee per payroll period**, ordered by date. For the *n*-th late:

```
ladder_position = ((n − 1) mod 3) + 1

position 1 → deduct 0.0 days
position 2 → deduct 0.5 days
position 3 → deduct 0.5 days
```

Test vectors:

| Late # | Ladder position | Deducted this time | Cumulative days |
|---|---|---|---|
| 1 | 1 | 0.0 | 0.0 |
| 2 | 2 | 0.5 | 0.5 |
| 3 | 3 | 0.5 | **1.0** |
| 4 | 1 | 0.0 | 1.0 |
| 5 | 2 | 0.5 | 1.5 |
| 6 | 3 | 0.5 | **2.0** |
| 7 | 1 | 0.0 | 2.0 |

Counter resets to zero at the start of each payroll period. `late_deduction_amount = deducted_days × daily_rate`.

### 7.2.1 Severe lateness

The ladder counts **occurrences, not magnitude** — on its own, a 20-minute late and a 3-hour late advance it identically. Hours worked normally catches the difference (a badly late employee who still leaves at closing falls under the half-day or absent threshold in §6), but **not** when they make up the time by staying later.

So severity is handled explicitly:

```
late_minutes > half_day_after_late_minutes  →  status = half_day
```

Default **120 minutes**, configurable per `work_schedule_template`.

- Applies **regardless of hours worked.** Arriving 3 hours late and staying 3 hours later is still a half day: the cost of lateness is that nobody covered the counter at opening, and that is not undone by staying past close.
- The ladder still applies **on top** — a severe late is also a late, and advances the count.
- Worked examples, 11:00–20:00 schedule (540 min), grace 15, threshold 120:

| Arrival | Departure | Worked | `late_minutes` | Status | Cost |
|---|---|---|---|---|---|
| 11:20 | 20:00 | 535 | 5 | `present` | ladder only |
| 13:00 | 20:00 | 420 | 105 | `half_day` (hours) | 0.5 day + ladder |
| 13:30 | 22:30 | 540 | 135 | **`half_day` (late)** | 0.5 day + ladder |
| 16:00 | 20:00 | 240 | 285 | `absent` (hours) | 1.0 day + ladder |
| 16:00 | 01:00 | 540 | 285 | **`half_day` (late)** | 0.5 day + ladder |

Rows 3 and 5 are the ones this rule exists for: full hours worked, but the day still costs half a day's pay.

### 7.3 Absence and half days

| Condition | Effect |
|---|---|
| `status = absent`, no approved leave | deduct 1.0 day |
| `status = half_day` | deduct 0.5 day |
| `status = leave_unpaid` | deduct 1.0 day per leave day |
| `status = leave_paid`, `weekly_off`, `holiday` | no deduction |

### 7.4 Waivers and manual adjustments

Two distinct mechanisms, both mandatory-reason and both visible on the payslip:

- **`attendance_exceptions` (kind = `waiver`)** — approved *before* payroll computes. The deduction is calculated, then reduced, and both lines print: `Late deduction −1,666.67` followed by `Late deduction waived (Ali Raza — bike breakdown, verified) +1,666.67`.
- **`payroll_adjustments`** — applied *after* computation by Admin or HR Manager (`payroll:adjust`). Can waive any deduction, add a deduction, or add an earning. Never mutates the computed figure.

The design intent is that a payslip always shows what the machine decided **and** every human intervention on top of it, with the actor named. Nothing is silently corrected.

---

## 8. Offs, leaves and holidays

- Entitlement: **4 offs per calendar month**, paid, floating (employee picks the day, subject to roster).
- Offs do **not** carry forward.
- **Unused offs are encashed** at `daily_rate`, capped at the monthly entitlement:
  ```
  encashed_off_days   = max(0, offs_entitled − offs_taken)
  encashment_amount   = encashed_off_days × daily_rate
  ```
- Days taken beyond entitlement fall to `beyond_quota_treatment` — default `unpaid_leave`.
- `public_holidays` are separate from monthly offs and do not consume the quota.

> **Intentional.** Because offs are paid, non-carrying *and* encashed, an employee who never takes a day off earns four extra days' pay per month. This is deliberate client policy — offs are an entitlement the employee may either take or sell back. Implementation must not "optimise" it away, and payroll must budget for up to 4 extra days per employee per month.

---

## 9. Overtime

- OT accrues into `overtime_minutes_pending` once a day clears `min_minutes_to_qualify`, rounded to `rounding_minutes`, subject to daily and monthly caps.
- A manager confirms it after the fact via an `attendance_exception` of kind `overtime_approval`, moving minutes into `overtime_minutes_approved`.
- **Payroll pays `overtime_minutes_approved` only.** Unapproved OT is reported but never paid.
- This makes an attendance review a mandatory monthly step before a payroll run can be approved. The run's pre-flight check lists every day with pending OT.
- Rate resolution: `designation + branch → branch → designation → tenant default`. Weekly-off and holiday multipliers apply on top.

---

## 10. Payroll

### 10.1 State machine

```
draft ──compute──▶ computed ──submit──▶ pending_approval ──approve──▶ approved ──pay──▶ paid
  ▲                    │                                                  │
  └──── recompute ─────┘                                                  ▼
                                                                      reversed
```

- `compute` and `recompute` are freely repeatable while the run is `draft`/`computed`.
- **`approve` locks** every `attendance_day` in the period (`is_locked = true`).
- After approval there is **no edit path.** Corrections are either a `reversed` run (with reason, unlocking the period) or a `payroll_adjustment` carried into the next period. Approved payroll is a financial record.
- Pre-flight blocks approval on: days with pending OT, unresolved `missing_out` flags, pending waiver requests, and employees with no effective salary structure.

### 10.2 Computation order

Deterministic, and each step emits its own `payroll_line_items` so the payslip reads top to bottom:

1. Resolve the salary structure effective in the period (prorate if it changed mid-period).
2. Gather attendance facts from `attendance_days` — day counts by status, worked minutes, approved OT, late ordinals.
3. **Earnings** — basic (prorated for mid-period joiners and leavers), allowances, approved OT, off encashment, rider per-delivered-order component.
4. **Deductions** — absence, the late ladder (§7.2), unpaid leave, loan/advance installments.
5. **Waivers** — approved `attendance_exceptions`, each its own visible line.
6. **Adjustments** — `payroll_adjustments`, each its own visible line with actor and reason.
7. `net_payable = gross_earnings − total_deductions`.

### 10.3 Payslip

PDF generated per `payroll_line`, downloaded and printed by the manager at the branch. Shows every line item including waivers and adjustments with the reason text. No SMS delivery, no employee download — there is no employee login in v1.

---

## 11. Attendance capture on the POS

There is no biometric device. **This design does not prove identity — it deters substitution and makes it auditable.** Stating that plainly here so no one later mistakes the audit trail for proof.

### 11.1 The Attendance Station

A POS tab plus a standalone `/attendance` route, so a tablet can be parked at the staff entrance.

**Primary flow:** employee enters their **employee code**, then their **6-digit PIN**. PIN is bcrypt-hashed like a password, resettable by a manager, locked for 15 minutes after 5 failed attempts. Works for staff with no `users` row, which is most of them.

**Configurable per tenant, overridable per branch** (`attendance_capture_policies`):

| Option | Effect |
|---|---|
| `primary_method: pin` | Employee code + PIN (default) |
| `primary_method: qr_card` | Printed card with a signed, rotatable token, scanned by the POS barcode scanner |
| `require_photo` | Camera snapshot stored against the punch. Independent of method — PIN+photo, QR+photo or either alone |
| `allow_manager_attestation` | Supervisor roll-call screen; gated by `attendance:attest` |

### 11.2 Controls

- Server timestamps only.
- Every punch is bound to `branch_id` and stamps `pos_user_id` — whichever till session was on screen. If one cashier punches in the whole team, the data shows it. There is no per-device binding (decision #22).
- Duplicate-punch suppression, default 60 seconds.
- Manager-attested punches are always tagged `source = manager_attestation` and always appear in the exceptions report. They are never silently equivalent to a self-punch.
- Punch photos are retained **90 days**, then purged. Indefinite retention of staff photographs is a storage cost and a privacy exposure with no operational benefit.

### 11.3 Exceptions report — a first-class screen

Surfaces: manager-attested punches, photo-less punches where photo is required, orphan punches, missing clock-outs, punches outside the rostered window, riders who checked in on the app but never punched, and **burst detection** — many punches under one `pos_user_id` at one branch within a short window, i.e. one person punching for everybody.

---

## 12. Rider convergence

Riders punch on the POS like everyone else (decision #5). This creates two records per rider per day, so the precedence is fixed:

- **`attendance_punches` (POS) is authoritative** for attendance, deductions and pay.
- **`rider_attendance_sessions` (rider app) stays dispatch-only** — availability for order assignment. It never feeds payroll.
- A rider who checked in on the app but never punched on the POS appears in the exceptions report. The discrepancy is visible rather than silent.

**Pay:** the new payroll engine is the only engine. Rider-specific facts (completed deliveries, timely deliveries, average rating) are supplied by a **rider fact-provider** to the same component calculation, so a rider's basic + per-delivered-order pay is one payslip alongside everyone else's.

### After the merge — what each module owns

| | Owns | Where |
|---|---|---|
| **HR & Payroll** | Everyone's pay, attendance, leave, reviews, training — riders included | `/admin/hr/*` |
| **Rider Ops** | Dispatch only: supervisor view, rider pool & sharing, rider profiles | `/admin/rider-hrm/*` |

The sidebar group was renamed from "Rider HRM" to **Rider Ops** for exactly this
reason — two groups called HRM left a standing question about which one paid
people. The rider profile screen keeps its base-salary column but it is now
READ-ONLY and labelled legacy: payroll reads `employee_salary_structures`, so an
edit there would change a number nobody is paid from. Compensation plans and
rider payroll runs stay routed (history must stay readable) but are deliberately
not returning to the menu.

### Production runbook — merging rider pay (no data loss)

`npm run merge:rider-hrm` moves rider PAY onto the employee payroll engine. It
is written to be run against production:

1. **Deploy the code first.** The script only reads and inserts; it needs no
   schema change beyond what the HRM migrations already applied.
2. **Dry run:** `npm run merge:rider-hrm`. It prints one row per rider — the pay
   it found, where it came from (an active comp plan, or the rider profile's
   `base_salary` / `default_per_ride_commission`), and every rider it will SKIP
   with the reason. Nothing is written.
3. **Read the skips.** Common ones: the rider already has an open salary
   structure (already merged), the tenant has no rider/delivery designation, or
   the rider is on no branch. Fix those first if they matter; the script can be
   re-run.
4. **Apply:** `npm run merge:rider-hrm -- --apply`. One transaction — a failure
   leaves the database exactly as it was.
5. **Check** HR → Employees, then run payroll for the period and compare a
   rider's payslip against their last rider payroll run.

What it never does: delete or modify a `rider_profile`, a `rider_comp_plan`, or
any `rider_payroll_run / line / line_item`. Rider payroll history stays intact
and readable. Re-running is safe — a rider with an open salary structure is
skipped, not duplicated.

Salary structures are opened effective the **1st of the current month**, never
back-dated: back-dating into a closed period would change a payslip somebody has
already been paid against.

Dispatch is deliberately NOT merged. Rider profiles, availability, the assignment
ledger, break sessions, live locations and pool sharing are operations, not HR.

**Migration (Phase 4):** `rider_comp_plans` and their components migrate into `employee_salary_structures` + `employee_salary_components`, with `per_delivered_order_amount` carrying the per-ride rate. `rider_payroll_runs / lines / line_items` are frozen read-only so historical runs stay viewable. The existing `payroll.utils.ts` `per_ride` calc basis becomes `per_delivered_order` in the new engine.

---

## 13. Reviews and promotion

### 13.1 Two independent tracks

| | Scheduled | Ad-hoc |
|---|---|---|
| `origin` | `system` | `manual` |
| `cycle_type` | `probation_3m`, `quarterly` | `ad_hoc` |
| Created by | Daily scheduler job | A user with `reviews:initiate-adhoc` |
| Affects the cadence | **Yes** | **Never** |
| Can produce outcomes | Yes | Yes — identical consequences |
| Counted in "reviews overdue" metrics | Yes | **No** |

**The rule, enforced in the data model:** the scheduler that generates upcoming cycles filters `origin = 'system'`. An ad-hoc review is therefore structurally incapable of delaying, replacing or satisfying a scheduled one. Both can be open simultaneously.

Cadence: first cycle at `date_of_joining + 3 months`, then every 3 months, anchored to the joining date and never moved by anything else.

`ad_hoc_reason` ∈ `promotion_consideration | performance_concern | post_training_assessment | disciplinary | pre_exit`

Reporting keeps them separate. "Review completion rate" counts scheduled cycles only — otherwise a manager inflates the metric by opening ad-hoc reviews. The employee's own history screen shows both, tagged, so the record reads honestly: *"5 reviews — 3 scheduled, 2 ad-hoc."*

**Deliberate non-feature:** there is no "count this ad-hoc review as the scheduled one" option. That checkbox is exactly how a quarterly cadence quietly dies. If an escape hatch is ever needed, the safe form is an explicit *"defer next scheduled review by N months, reason: ___"* action recorded as its own event.

### 13.2 Review cycle state machine

```
scheduled ──start──▶ in_progress ──submit──▶ submitted ──approve──▶ approved ──▶ closed
     │                                            │
     └──────────────── skip (reason) ─────────────┴──▶ skipped
```

### 13.3 Outcome application

On `approve`, in **one transaction**:

- `outcome = promoted` → close the current `employee_assignments` row, open a new one (`change_reason = 'promotion'`, new designation); close the current `employee_salary_structures` row, open a new one; write `employee_events` rows for both.
- `outcome = increment_only` → new salary structure only.
- `outcome = no_promotion` → event only, current state unchanged.
- `outcome = pip` → event + optional follow-up ad-hoc cycle.
- `outcome = terminate` → creates an `employee_exits` record in `pending` clearance.

This is what makes the history real rather than decorative: a promotion is a state change with a paper trail, not a note in a text field.

### 13.4 The review form

Config-driven from `review_templates.schema` (sections → questions → type, weight, required). The reviewer sees, beside the form:

- the full `employee_events` timeline,
- previous review scores and outcomes,
- training status against `designation_training_requirements` for the target designation.

Missing required training renders as a **warning** — ✓/✗ readiness with a prominent notice — but never blocks submission (decision #16). The `promotion_training_enforcement` enum retains `block` should the client change their mind.

---

## 14. RBAC

New permissions, added to `backend/src/roles/permissions.dto.ts`, with umbrella implications in `permission-implications.ts` and route gates in `auth/path-permissions.ts` under `/admin/hr/*`.

```
employees:view            employees:create        employees:edit
employees:terminate       employee-docs:view      employee-docs:manage
employee-pin:reset

attendance:view           attendance:punch        attendance:attest
attendance:adjust         attendance:approve      attendance-waiver:approve
attendance:recompute

leaves:view               leaves:request          leaves:approve
holidays:manage

overtime:view             overtime:approve

payroll:view              payroll:run             payroll:approve
payroll:reverse           payroll:adjust          payroll:export
salary:view               salary:edit

reviews:view              reviews:conduct         reviews:approve
reviews:initiate-adhoc

training:view             training:manage         training:record

hr-settings:manage        hr-audit:view
```

### 14.1 Roles

- **`hr_manager`** (new, seeded) — the full HR bundle including `salary:view`, `payroll:adjust`, `attendance-waiver:approve`.
- **Owner / GM** — everything, as today.
- **Branch Manager** — `employees:view`, `attendance:*` except `recompute`, `leaves:approve`, `overtime:approve`, `reviews:conduct`. **No `salary:view`, no `payroll:*`.**
- **Cashier / till staff** — `attendance:punch` only (the station runs on their terminal).

### 14.2 Salary visibility

`salary:view` is **standalone** — not implied by `employees:view`, not implied by any umbrella. Salary fields live in **separate response DTOs**, not conditionally stripped from a shared one: the global `ValidationPipe({ whitelist: true })` sanitises *input*, never output, so output leaks must be prevented structurally.

### 14.3 Scoping

Employees follow the existing scoping model exactly: `tenantId` + `allowedBranchIds` + `allowedBrandIds`, resolved by `RoleAccessGuard`.

- ⚠️ **`branches` has no `tenant_id` column.** A branch belongs to a tenant only through the brands linked to it (`branch_brands` → `brands.tenant_id`) — the platform's Tenant → {Brand, Branch} sibling model. Any HR check written as `branch.tenantId === user.tenantId` compiles to a comparison against `undefined` and silently permits cross-tenant writes. Validate through the join.

- A brand-locked manager sees employees at their branches whose assignment `brand_id` matches **or is null**. Shared staff — cleaners, security, porters — belong to the branch, not a brand, and must be visible to whoever manages that floor (decision #15).
- **Route-level path checks do not protect anything in this codebase.** The prefix table in `auth/path-permissions.ts` is matched against a request path that carries the global `/api` prefix, so nothing matches and [role-access.guard.ts](../backend/src/auth/role-access.guard.ts#L107) falls through to `return true`. Enforcement must therefore live in **`@RequirePermission()` method guards plus in-service scope checks**. No HR endpoint may rely on its route prefix for protection. Path entries are still added for the frontend nav gating, which reads the same table.

---

## 15. Admin surfaces

| Screen | Contents |
|---|---|
| Employees | List, filters (branch, brand, designation, status), create/edit, PIN reset, QR card issue |
| Employee 360 | ⭐ One page: profile, current assignment, `employee_events` timeline, salary history (gated), attendance summary, leave balances, training, reviews, documents, warnings |
| Attendance Station | `/attendance` — code + PIN or QR card, optional photo, manager roll-call. Opens from the top bar or its own tab; works with nobody logged in |
| Attendance Devices | Registering the tablets/terminals. Its OWN screen: registering a device is a one-off setup job and does not belong above the daily register |
| Daily Register | Branch × date grid, statuses, inline adjustment requests |
| Exceptions | §11.3 |
| Leaves | Requests, approvals, balances |
| Payroll | Runs, line detail, adjustments, payslip PDF, export |
| Reviews | Due/overdue queue, review form, outcome application |
| Training | Programs, assignment, completion recording, expiry |
| Exits | Exit records, clearance checklists, settlement |
| HR Settings | ⭐ One page, tabbed: shift templates, attendance capture, overtime, offs & public holidays, leave types, deduction rules, approval rules. Designations keep their own screen. Every write goes through the HR audit log |
| Roster | Weekly grid per branch: select cells, apply a shift / day off / holiday. An empty cell means the employee's default template |
| Advances | Salary advances, instalment recovery, write-offs |
| Alerts | Expiring documents and certificates, probations ending, overdue scheduled reviews — the same rows the admin bell shows |
| Labour cost | Labour as a percentage of sales, per branch and per brand |

**Reporting:** daily register, monthly muster roll, late/absent summary, overtime report, headcount and attrition, payroll register. Plus **labour cost as a percentage of sales, per branch and per brand** — sales already exist in `reports/`, so this is nearly free once payroll lands, and it is the number the owner will actually look at.

**Notifications** reuse the existing catalog (`notifications-system`): review due in 7 days, probation ending, document expiring, absent-without-leave today, pending OT before payroll lock, leave request pending, payroll awaiting approval.

---

## 16. Phasing

| Phase | Contents | Estimate |
|---|---|---|
| **0** | This document | done |
| **1** | Employee master, designations, assignments, documents, events timeline, Employee 360, **exit record + clearance**, `hr_manager` role, RBAC, backfill from `branch_users` | ~1.5 weeks |
| **2** | Attendance: capture policies, PIN/QR/photo/attestation, POS station, punches → `attendance_days` recompute, `branches.timezone` validation, schedules + roster tables, work-date rule, daily register, adjustments, exceptions report | ~2 weeks |
| **3** | Leave types, balances, requests → attendance, 4-offs policy, public holidays | ~1 week |
| **4** | Salary structures, deduction rules, OT policies + approval, waivers, payroll run state machine, adjustments, payslip PDF, **off encashment, exit settlement**, **rider convergence + migration** | ~2.5 weeks |
| **5** | Training programs and records, review templates, cycle scheduler, review form, outcome application | ~1.5 weeks |
| **6** | Loans/advances, document expiry alerts, labour-cost-vs-sales dashboard, roster calendar UI | ~1 week |
| **7** | HR Settings screens (shifts, capture, overtime, offs, leave types), `deduction_rules` + `hr_approval_rules` built and wired, roster bulk editing | ~1 week |

Phase 6 notes: advance recovery shipped with Phase 4 and gained its screen here. Expiry alerts are one nightly sweep (`hr-alerts.service.ts`) reconciled against the notification store, so the alerts screen and the admin bell read the same rows. Labour cost counts **whole approved runs only** — a run straddling the range is named, not pro-rated — and staff with no brand form their own row rather than being spread across brands. The roster honours `is_weekly_off` / `is_holiday` in the attendance engine as of this phase; before it, those columns were written by nothing and read by nothing.

**Total ≈ 8.5–9.5 weeks** for one developer. Phases 1–2 are independently shippable; nothing downstream blocks if 5–6 slip.

Sequencing note: exit **recording** lands in Phase 1 as requested, but final settlement arithmetic needs salary structures and encashment, so it lands with Phase 4. Between go-live and Phase 4, an exit is fully recorded and stops payroll/attendance correctly; the settlement amount is calculated manually.

---

## 17. Defaults

Set without further consultation, recorded here so nothing is silently assumed.

| Setting | Default |
|---|---|
| Grace period | 15 min (configurable per template) |
| Severe late → half day | more than 120 min late, regardless of hours worked |
| PIN | 6 digits, bcrypt, lock 15 min after 5 failures |
| Duplicate-punch window | 60 seconds |
| Punch photo retention | 90 days, then purged |
| Attribution lead / trail | 6 h / 6 h |
| Full day / half day | scheduled − 60 min / 50% of scheduled |
| Daily rate basis | `fixed_30` |
| Monthly offs | 4, paid, no carry-forward, encashed at daily rate |
| Payroll cycle | Calendar month |
| Review reminder | 7 days before due |
| OT rounding | 15 min, approval required |
| Branch timezone | Existing `branches.timezone`, already `Asia/Karachi` on live data; Phase 2 warns if any branch is left on `UTC` |

---

## 18. Open items

Small and non-blocking; defaults chosen, flagged for confirmation during the phase that consumes them.

1. **Early leaving.** `early_leave_minutes` is computed and reported, but carries no deduction unless hours worked already drop the day below the half-day threshold. This leaves the exact mirror of the case §7.2.1 fixes: an employee who arrives 3 hours early and leaves 3 hours early works full hours but is absent at closing. If the client wants it closed, the symmetric rule is `early_leave_minutes > early_leave_half_day_minutes → half_day`, one field on the same template. Not specified, so not built.
2. **Encashment cap.** Capped at the monthly entitlement (4 days). No annual cap specified.
3. **Off-day selection.** Floating; a roster is not required at launch since timings are fixed.

## 19. Non-goals for v1

Phone-OTP punching · employee self-service of any kind · employee-facing payslip delivery · biometric integration · multi-brand assignment for a single employee · historical data migration · tax/statutory deductions (EOBI, PESSI) — not requested, and adding them later is additive.
